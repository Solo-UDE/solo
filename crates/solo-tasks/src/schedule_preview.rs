//! Pure function: given a `Schedule`, return the next N fire times as UTC millis.

use crate::error::{TaskError, TaskResult};
use chrono::{DateTime, Datelike, TimeZone, Timelike, Utc, Weekday};
use croner::Cron;
use solo_protocol::{PresetKind, Schedule};

/// Compute the next `n` fire times from `now` (UTC millis).
/// `EventTriggered` returns empty — not time-bound.
/// `OneShot` at < now returns empty; otherwise single-element vec.
pub fn next_fires(schedule: &Schedule, now_ms: i64, n: usize) -> TaskResult<Vec<i64>> {
    match schedule {
        Schedule::OneShot { at } => {
            if *at > now_ms {
                Ok(vec![*at])
            } else {
                Ok(vec![])
            }
        }
        Schedule::Cron { expr, .. } => {
            let cron = Cron::new(expr)
                .parse()
                .map_err(|e| TaskError::Invalid(format!("cron parse: {e}")))?;
            let mut out = Vec::with_capacity(n);
            let mut cursor: DateTime<Utc> = Utc
                .timestamp_millis_opt(now_ms)
                .single()
                .ok_or_else(|| TaskError::Invalid("invalid now_ms".into()))?;
            for _ in 0..n {
                cursor = cron
                    .find_next_occurrence(&cursor, false)
                    .map_err(|e| TaskError::Invalid(format!("cron step: {e}")))?;
                out.push(cursor.timestamp_millis());
            }
            Ok(out)
        }
        Schedule::Preset {
            kind,
            hour,
            minute,
            weekday,
            ..
        } => {
            let mut out = Vec::with_capacity(n);
            let mut cursor = next_preset_fire(*kind, *hour, *minute, *weekday, now_ms)?;
            for _ in 0..n {
                out.push(cursor);
                cursor = next_preset_fire(*kind, *hour, *minute, *weekday, cursor + 1000)?;
            }
            Ok(out)
        }
        Schedule::EventTriggered { .. } => Ok(vec![]),
    }
}

fn next_preset_fire(
    kind: PresetKind,
    hour: u8,
    minute: u8,
    weekday: Option<u8>,
    now_ms: i64,
) -> TaskResult<i64> {
    let now = Utc
        .timestamp_millis_opt(now_ms)
        .single()
        .ok_or_else(|| TaskError::Invalid("invalid now_ms".into()))?;
    let h = u32::from(hour);
    let m = u32::from(minute);

    match kind {
        PresetKind::Hourly => {
            // Next occurrence of :MM in the next hour (or this hour if >now)
            let candidate = now
                .with_minute(m)
                .and_then(|d| d.with_second(0))
                .and_then(|d| d.with_nanosecond(0))
                .ok_or_else(|| TaskError::Invalid("preset math".into()))?;
            Ok(if candidate > now {
                candidate.timestamp_millis()
            } else {
                (candidate + chrono::Duration::hours(1)).timestamp_millis()
            })
        }
        PresetKind::Daily => {
            let candidate = now
                .with_hour(h)
                .and_then(|d| d.with_minute(m))
                .and_then(|d| d.with_second(0))
                .and_then(|d| d.with_nanosecond(0))
                .ok_or_else(|| TaskError::Invalid("preset math".into()))?;
            Ok(if candidate > now {
                candidate.timestamp_millis()
            } else {
                (candidate + chrono::Duration::days(1)).timestamp_millis()
            })
        }
        PresetKind::Weekly => {
            let target_wd = weekday.unwrap_or(0);
            let now_wd = weekday_idx(now.weekday());
            let days_fwd = (i64::from(target_wd) - i64::from(now_wd) + 7) % 7;
            let candidate = now
                .with_hour(h)
                .and_then(|d| d.with_minute(m))
                .and_then(|d| d.with_second(0))
                .and_then(|d| d.with_nanosecond(0))
                .map(|d| d + chrono::Duration::days(days_fwd))
                .ok_or_else(|| TaskError::Invalid("preset math".into()))?;
            Ok(if candidate > now {
                candidate.timestamp_millis()
            } else {
                (candidate + chrono::Duration::days(7)).timestamp_millis()
            })
        }
        PresetKind::Monthly => {
            // Same day-of-month as current, at hour:minute. If past today, next month's same dom.
            let dom = now.day();
            let mut y = now.year();
            let mut mo = now.month();
            let candidate = Utc
                .with_ymd_and_hms(y, mo, dom, h, m, 0)
                .single()
                .ok_or_else(|| TaskError::Invalid("preset math".into()))?;
            if candidate <= now {
                mo += 1;
                if mo == 13 {
                    mo = 1;
                    y += 1;
                }
            }
            let fire = Utc
                .with_ymd_and_hms(y, mo, dom.min(28), h, m, 0)
                .single()
                .ok_or_else(|| TaskError::Invalid("preset math".into()))?;
            Ok(fire.timestamp_millis())
        }
    }
}

fn weekday_idx(wd: Weekday) -> u8 {
    match wd {
        Weekday::Mon => 0,
        Weekday::Tue => 1,
        Weekday::Wed => 2,
        Weekday::Thu => 3,
        Weekday::Fri => 4,
        Weekday::Sat => 5,
        Weekday::Sun => 6,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn oneshot_future_returns_one() {
        let now = 1_000_000;
        let s = Schedule::OneShot { at: now + 10_000 };
        let r = next_fires(&s, now, 5).unwrap();
        assert_eq!(r, vec![now + 10_000]);
    }

    #[test]
    fn oneshot_past_returns_empty() {
        let now = 1_000_000;
        let s = Schedule::OneShot { at: now - 1 };
        let r = next_fires(&s, now, 5).unwrap();
        assert!(r.is_empty());
    }

    #[test]
    fn preset_daily_returns_n_fires() {
        let now = Utc
            .with_ymd_and_hms(2026, 4, 21, 14, 30, 0)
            .unwrap()
            .timestamp_millis();
        let s = Schedule::Preset {
            kind: PresetKind::Daily,
            hour: 3,
            minute: 0,
            weekday: None,
            next_fire: 0,
        };
        let r = next_fires(&s, now, 3).unwrap();
        assert_eq!(r.len(), 3);
        // Each subsequent fire should be +24h
        assert_eq!(r[1] - r[0], 86_400_000);
    }

    #[test]
    fn cron_every_5_min_returns_monotonic() {
        let now = Utc
            .with_ymd_and_hms(2026, 4, 21, 14, 0, 0)
            .unwrap()
            .timestamp_millis();
        let s = Schedule::Cron {
            expr: "*/5 * * * *".into(),
            next_fire: 0,
        };
        let r = next_fires(&s, now, 3).unwrap();
        assert_eq!(r.len(), 3);
        assert!(r[0] < r[1]);
        assert!(r[1] < r[2]);
    }

    #[test]
    fn event_triggered_returns_empty() {
        let s = Schedule::EventTriggered {
            event: solo_protocol::EventKind::AgentSessionEnded,
        };
        assert!(next_fires(&s, 0, 5).unwrap().is_empty());
    }
}
