//! Time Utilities

use chrono::{DateTime, Utc};

/// Get current UTC timestamp
pub fn now_utc() -> DateTime<Utc> {
    Utc::now()
}

/// Parse datetime from RFC 3339 string
pub fn parse_datetime(s: &str) -> Option<DateTime<Utc>> {
    chrono::DateTime::parse_from_rfc3339(s)
        .ok()
        .map(|dt| dt.with_timezone(&Utc))
}

/// Format datetime as RFC 3339 string
pub fn format_datetime(dt: &DateTime<Utc>) -> String {
    dt.to_rfc3339()
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::Datelike;

    #[test]
    fn test_now_utc() {
        let now = now_utc();
        // Just check it returns a valid time
        assert!(now.timestamp() > 0);
    }

    #[test]
    fn test_parse_format_roundtrip() {
        let now = now_utc();
        let formatted = format_datetime(&now);
        let parsed = parse_datetime(&formatted).unwrap();

        // Timestamps should be equal (may lose sub-second precision)
        assert_eq!(now.timestamp(), parsed.timestamp());
    }

    #[test]
    fn test_parse_invalid() {
        assert!(parse_datetime("not a date").is_none());
        assert!(parse_datetime("").is_none());
    }

    #[test]
    fn test_parse_valid() {
        let dt = parse_datetime("2024-01-15T10:30:00Z").unwrap();
        assert_eq!(dt.year(), 2024);
        assert_eq!(dt.month(), 1);
        assert_eq!(dt.day(), 15);
    }
}

