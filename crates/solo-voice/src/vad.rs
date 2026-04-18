//! Silero VAD wrapper.
//!
//! Wraps the Silero VAD ONNX model for voice activity detection.
//! The model expects 512-sample frames at 16 kHz with recurrent state
//! tensors `h` (2,1,64) and `c` (2,1,64) that carry state between calls.
//!
//! Note: Phase 1 provides the full session-load skeleton and the RMS helper
//! that is exercised by the unit tests. The `probability` method performs a
//! real inference call against the ONNX model when one is present. VAD is not
//! on the v1 critical path for chat-mic (sherpa-rs handles its own silence
//! detection); end-of-speech detection via Silero will be wired in Phase 2
//! when the hotkey-tap flow needs it.

use std::path::Path;

use ort::{session::Session, value::Tensor};

use crate::error::{Result, VoiceError};

/// 30 ms at 16 kHz.
pub const FRAME_SAMPLES: usize = 480;

/// Number of samples the Silero VAD model expects per inference call.
const SILERO_INPUT_SAMPLES: usize = 512;

/// Size of the recurrent dimension in the Silero VAD state tensors.
const RNN_STATE_SIZE: usize = 2 * 64; // shape (2,1,64), flattened

/// Compute the Root Mean Square of a frame.
///
/// Returns `0.0` for an empty slice.
pub fn rms(frame: &[f32]) -> f32 {
    if frame.is_empty() {
        return 0.0;
    }
    let sum_sq: f32 = frame.iter().map(|s| s * s).sum();
    (sum_sq / frame.len() as f32).sqrt()
}

/// Silero VAD session with persistent recurrent state.
pub struct SileroVad {
    session: Session,
    /// Recurrent state tensor `h`, shape (2,1,64), flattened.
    h: Vec<f32>,
    /// Recurrent state tensor `c`, shape (2,1,64), flattened.
    c: Vec<f32>,
}

impl SileroVad {
    /// Load the Silero VAD ONNX model from `model_path`.
    pub fn load(model_path: &Path) -> Result<Self> {
        let session = Session::builder()
            .map_err(|e| VoiceError::Vad(format!("ort session builder failed: {e}")))?
            .commit_from_file(model_path)
            .map_err(|e| VoiceError::Vad(format!("failed to load VAD model from {}: {e}", model_path.display())))?;

        Ok(Self {
            session,
            h: vec![0.0_f32; RNN_STATE_SIZE],
            c: vec![0.0_f32; RNN_STATE_SIZE],
        })
    }

    /// Run the model on a single `FRAME_SAMPLES`-length frame.
    ///
    /// Returns the probability (0.0–1.0) that speech is present.
    ///
    /// # Errors
    /// Returns [`VoiceError::Vad`] if `frame.len() != FRAME_SAMPLES` or if
    /// the ONNX inference fails.
    pub fn probability(&mut self, frame: &[f32]) -> Result<f32> {
        if frame.len() != FRAME_SAMPLES {
            return Err(VoiceError::Vad(format!(
                "expected {} samples, got {}",
                FRAME_SAMPLES,
                frame.len()
            )));
        }

        // Silero VAD expects exactly 512 samples; zero-pad the 480-sample frame.
        let mut input_buf = vec![0.0_f32; SILERO_INPUT_SAMPLES];
        input_buf[..FRAME_SAMPLES].copy_from_slice(frame);

        // Build input tensors.
        // audio:  shape [1, 512], f32
        // sr:     shape [1],      i64  (sample rate)
        // h:      shape [2,1,64], f32
        // c:      shape [2,1,64], f32
        let audio_tensor = Tensor::<f32>::from_array(([1usize, SILERO_INPUT_SAMPLES], input_buf))
            .map_err(|e| VoiceError::Vad(format!("audio tensor: {e}")))?;

        let sr_tensor = Tensor::<i64>::from_array(([1usize], vec![16_000_i64]))
            .map_err(|e| VoiceError::Vad(format!("sr tensor: {e}")))?;

        let h_tensor = Tensor::<f32>::from_array(([2usize, 1, 64], self.h.clone()))
            .map_err(|e| VoiceError::Vad(format!("h tensor: {e}")))?;

        let c_tensor = Tensor::<f32>::from_array(([2usize, 1, 64], self.c.clone()))
            .map_err(|e| VoiceError::Vad(format!("c tensor: {e}")))?;

        let outputs = self
            .session
            .run(ort::inputs! {
                "input"  => audio_tensor,
                "sr"     => sr_tensor,
                "h"      => h_tensor,
                "c"      => c_tensor,
            })
            .map_err(|e| VoiceError::Vad(format!("ort inference error: {e}")))?;

        // Extract speech probability (output name "output").
        let prob = outputs["output"]
            .try_extract_array::<f32>()
            .map_err(|e| VoiceError::Vad(format!("output extract error: {e}")))?;
        let prob_val = prob.iter().next().copied().unwrap_or(0.0);

        // Update recurrent state from model outputs.
        if let Some(hn) = outputs.get("hn") {
            if let Ok(arr) = hn.try_extract_array::<f32>() {
                let data: Vec<f32> = arr.iter().copied().collect();
                if data.len() == RNN_STATE_SIZE {
                    self.h = data;
                }
            }
        }
        if let Some(cn) = outputs.get("cn") {
            if let Ok(arr) = cn.try_extract_array::<f32>() {
                let data: Vec<f32> = arr.iter().copied().collect();
                if data.len() == RNN_STATE_SIZE {
                    self.c = data;
                }
            }
        }

        Ok(prob_val)
    }

    /// Reset the recurrent state to all zeros (treat next frame as a fresh
    /// stream start).
    pub fn reset(&mut self) {
        self.h.iter_mut().for_each(|v| *v = 0.0);
        self.c.iter_mut().for_each(|v| *v = 0.0);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rms_of_silence_is_zero() {
        let frame = vec![0.0_f32; FRAME_SAMPLES];
        assert_eq!(rms(&frame), 0.0);
    }

    #[test]
    fn rms_of_dc_is_magnitude() {
        let amplitude = 0.5_f32;
        let frame = vec![amplitude; FRAME_SAMPLES];
        let result = rms(&frame);
        // For a DC signal all samples are `amplitude`, so RMS == amplitude.
        assert!((result - amplitude).abs() < 1e-6, "rms={result}");
    }
}
