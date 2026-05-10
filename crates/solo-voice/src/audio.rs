use crate::error::{Result, VoiceError};
use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use std::sync::{Arc, Mutex};

pub const SAMPLE_RATE: u32 = 16_000;
const BUFFER_CAPACITY_SAMPLES: usize = SAMPLE_RATE as usize * 60; // 60 s max

/// Lock-free-ish ring buffer. A Mutex<VecDeque<f32>> is fine for 16 kHz — the
/// cpal callback pushes ~160 samples every 10 ms, contention is negligible.
#[derive(Clone, Default)]
pub struct AudioRing {
    inner: Arc<Mutex<AudioRingInner>>,
}

#[derive(Default)]
struct AudioRingInner {
    samples: std::collections::VecDeque<f32>,
    dropped: u64,
}

impl AudioRing {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn push(&self, data: &[f32]) {
        let mut g = self.inner.lock().unwrap();
        for s in data {
            if g.samples.len() >= BUFFER_CAPACITY_SAMPLES {
                g.samples.pop_front();
                g.dropped += 1;
            }
            g.samples.push_back(*s);
        }
    }

    pub fn drain_all(&self) -> Vec<f32> {
        let mut g = self.inner.lock().unwrap();
        g.samples.drain(..).collect()
    }

    pub fn len(&self) -> usize {
        self.inner.lock().unwrap().samples.len()
    }

    pub fn is_empty(&self) -> bool {
        self.len() == 0
    }

    pub fn dropped(&self) -> u64 {
        self.inner.lock().unwrap().dropped
    }

    pub fn clear(&self) {
        let mut g = self.inner.lock().unwrap();
        g.samples.clear();
        g.dropped = 0;
    }

    /// Returns a copy of the last `n` samples without draining the ring.
    /// If fewer than `n` samples are buffered, returns all of them.
    pub fn peek_last(&self, n: usize) -> Vec<f32> {
        let g = self.inner.lock().unwrap();
        let len = g.samples.len();
        let skip = len.saturating_sub(n);
        g.samples.iter().skip(skip).copied().collect()
    }
}

/// Thread-owned audio capture. `cpal::Stream` is `!Send` on macOS (CoreAudio
/// constraint), so the stream lives on a dedicated OS thread. Dropping
/// `AudioStream` sets `stop`, which the thread observes and then drops the
/// cpal stream locally.
pub struct AudioStream {
    stop: std::sync::Arc<std::sync::atomic::AtomicBool>,
    thread: Option<std::thread::JoinHandle<()>>,
}

impl Drop for AudioStream {
    fn drop(&mut self) {
        self.stop.store(true, std::sync::atomic::Ordering::SeqCst);
        if let Some(h) = self.thread.take() {
            let _ = h.join();
        }
    }
}

pub fn start_capture(ring: AudioRing) -> Result<AudioStream> {
    let stop = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
    let stop_for_thread = stop.clone();
    let (init_tx, init_rx) = std::sync::mpsc::channel::<Result<()>>();

    let thread = std::thread::spawn(move || {
        // All cpal interactions happen on THIS thread.
        let res: Result<cpal::Stream> = (|| {
            let host = cpal::default_host();
            let device = host
                .default_input_device()
                .ok_or_else(|| VoiceError::Audio("no default input device".into()))?;
            let config = device
                .default_input_config()
                .map_err(|e| VoiceError::Audio(e.to_string()))?;
            let channels = config.channels() as usize;
            let input_rate = config.sample_rate().0;
            let err_fn = |err| tracing::error!("cpal error: {err}");
            let ring_for_cb = ring.clone();

            let stream = match config.sample_format() {
                cpal::SampleFormat::F32 => device.build_input_stream(
                    &config.into(),
                    move |data: &[f32], _| {
                        let mono = downmix_f32(data, channels);
                        let resampled = if input_rate == SAMPLE_RATE {
                            mono
                        } else {
                            linear_resample(&mono, input_rate, SAMPLE_RATE)
                        };
                        ring_for_cb.push(&resampled);
                    },
                    err_fn,
                    None,
                ),
                cpal::SampleFormat::I16 => device.build_input_stream(
                    &config.into(),
                    move |data: &[i16], _| {
                        let mono: Vec<f32> =
                            data.iter().map(|s| *s as f32 / i16::MAX as f32).collect();
                        let mono = downmix_f32(&mono, channels);
                        let resampled = if input_rate == SAMPLE_RATE {
                            mono
                        } else {
                            linear_resample(&mono, input_rate, SAMPLE_RATE)
                        };
                        ring_for_cb.push(&resampled);
                    },
                    err_fn,
                    None,
                ),
                other => {
                    return Err(VoiceError::Audio(format!(
                        "unsupported sample format: {other:?}"
                    )))
                }
            }
            .map_err(|e| VoiceError::Audio(e.to_string()))?;
            stream
                .play()
                .map_err(|e| VoiceError::Audio(e.to_string()))?;
            Ok(stream)
        })();

        let stream = match res {
            Ok(s) => {
                let _ = init_tx.send(Ok(()));
                s
            }
            Err(e) => {
                let _ = init_tx.send(Err(e));
                return;
            }
        };

        // Park until asked to stop, then drop the stream locally.
        while !stop_for_thread.load(std::sync::atomic::Ordering::SeqCst) {
            std::thread::sleep(std::time::Duration::from_millis(25));
        }
        drop(stream);
    });

    // Wait for the thread to finish initialising cpal (or fail).
    match init_rx.recv() {
        Ok(Ok(())) => Ok(AudioStream {
            stop,
            thread: Some(thread),
        }),
        Ok(Err(e)) => Err(e),
        Err(_) => Err(VoiceError::Audio("audio thread panicked".into())),
    }
}

fn downmix_f32(samples: &[f32], channels: usize) -> Vec<f32> {
    if channels <= 1 {
        return samples.to_vec();
    }
    let frames = samples.len() / channels;
    (0..frames)
        .map(|i| {
            let s: f32 = (0..channels).map(|c| samples[i * channels + c]).sum();
            s / channels as f32
        })
        .collect()
}

/// Cheap linear interpolation resampler. Fine for voice at 16 kHz target.
fn linear_resample(input: &[f32], in_rate: u32, out_rate: u32) -> Vec<f32> {
    if in_rate == out_rate || input.is_empty() {
        return input.to_vec();
    }
    let ratio = out_rate as f64 / in_rate as f64;
    let out_len = ((input.len() as f64) * ratio).round() as usize;
    (0..out_len)
        .map(|i| {
            let src_pos = i as f64 / ratio;
            let idx = src_pos.floor() as usize;
            let frac = src_pos - idx as f64;
            let a = input[idx.min(input.len() - 1)];
            let b = input[(idx + 1).min(input.len() - 1)];
            (a as f64 * (1.0 - frac) + b as f64 * frac) as f32
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ring_push_drain() {
        let r = AudioRing::new();
        r.push(&[0.1, 0.2, 0.3]);
        assert_eq!(r.len(), 3);
        let out = r.drain_all();
        assert_eq!(out, vec![0.1, 0.2, 0.3]);
        assert!(r.is_empty());
    }

    #[test]
    fn ring_drops_when_full() {
        let r = AudioRing::new();
        let big = vec![0.0f32; BUFFER_CAPACITY_SAMPLES + 100];
        r.push(&big);
        assert_eq!(r.len(), BUFFER_CAPACITY_SAMPLES);
        assert_eq!(r.dropped(), 100);
    }

    #[test]
    fn downmix_stereo_to_mono_averages() {
        let stereo = vec![1.0, 0.0, 0.5, 0.5];
        let mono = downmix_f32(&stereo, 2);
        assert_eq!(mono, vec![0.5, 0.5]);
    }

    #[test]
    fn linear_resample_halves() {
        let input: Vec<f32> = (0..100).map(|i| i as f32).collect();
        let out = linear_resample(&input, 32_000, 16_000);
        assert!((out.len() as i32 - 50).abs() <= 1);
    }
}
