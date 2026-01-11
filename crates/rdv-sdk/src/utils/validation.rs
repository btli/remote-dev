//! Validation Utilities

use thiserror::Error;

/// Validation error types
#[derive(Debug, Error)]
pub enum ValidationError {
    #[error("Invalid ID format: {0}")]
    InvalidId(String),

    #[error("Invalid version format: {0}")]
    InvalidVersion(String),

    #[error("Field required: {0}")]
    Required(String),

    #[error("Value out of range: {0}")]
    OutOfRange(String),

    #[error("Invalid format: {0}")]
    InvalidFormat(String),
}

/// Validate an ID string
///
/// Valid IDs are:
/// - 1-128 characters
/// - Lowercase alphanumeric with hyphens and underscores
/// - Must start with a letter
pub fn validate_id(id: &str) -> Result<(), ValidationError> {
    if id.is_empty() {
        return Err(ValidationError::Required("ID cannot be empty".into()));
    }

    if id.len() > 128 {
        return Err(ValidationError::InvalidId(
            "ID must be 128 characters or less".into(),
        ));
    }

    let first = id.chars().next().unwrap();
    if !first.is_ascii_lowercase() {
        return Err(ValidationError::InvalidId(
            "ID must start with a lowercase letter".into(),
        ));
    }

    for (i, c) in id.chars().enumerate() {
        if !c.is_ascii_lowercase() && !c.is_ascii_digit() && c != '-' && c != '_' {
            return Err(ValidationError::InvalidId(format!(
                "Invalid character '{}' at position {}",
                c, i
            )));
        }
    }

    // No consecutive hyphens or underscores
    if id.contains("--") || id.contains("__") || id.contains("-_") || id.contains("_-") {
        return Err(ValidationError::InvalidId(
            "ID cannot have consecutive hyphens or underscores".into(),
        ));
    }

    // Cannot end with hyphen or underscore
    if id.ends_with('-') || id.ends_with('_') {
        return Err(ValidationError::InvalidId(
            "ID cannot end with hyphen or underscore".into(),
        ));
    }

    Ok(())
}

/// Validate a semver version string
///
/// Accepts:
/// - Major.Minor (e.g., "1.0")
/// - Major.Minor.Patch (e.g., "1.0.0")
/// - With optional prerelease (e.g., "1.0.0-alpha.1")
pub fn validate_version(version: &str) -> Result<(), ValidationError> {
    if version.is_empty() {
        return Err(ValidationError::Required("Version cannot be empty".into()));
    }

    // Split on hyphen for prerelease
    let parts: Vec<&str> = version.splitn(2, '-').collect();
    let version_part = parts[0];

    // Split version numbers
    let nums: Vec<&str> = version_part.split('.').collect();

    if nums.len() < 2 || nums.len() > 3 {
        return Err(ValidationError::InvalidVersion(
            "Version must be Major.Minor or Major.Minor.Patch format".into(),
        ));
    }

    // Validate each part is a number
    for (i, num) in nums.iter().enumerate() {
        if num.is_empty() {
            return Err(ValidationError::InvalidVersion(format!(
                "Empty version component at position {}",
                i
            )));
        }

        if !num.chars().all(|c| c.is_ascii_digit()) {
            return Err(ValidationError::InvalidVersion(format!(
                "Invalid version component '{}' at position {}",
                num, i
            )));
        }

        // No leading zeros (except for "0" itself)
        if num.len() > 1 && num.starts_with('0') {
            return Err(ValidationError::InvalidVersion(format!(
                "Version component cannot have leading zeros: '{}'",
                num
            )));
        }
    }

    // Validate prerelease if present
    if parts.len() == 2 {
        let prerelease = parts[1];
        if prerelease.is_empty() {
            return Err(ValidationError::InvalidVersion(
                "Prerelease identifier cannot be empty".into(),
            ));
        }

        // Prerelease can contain alphanumeric and dots
        for c in prerelease.chars() {
            if !c.is_ascii_alphanumeric() && c != '.' {
                return Err(ValidationError::InvalidVersion(format!(
                    "Invalid character '{}' in prerelease",
                    c
                )));
            }
        }
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_validate_id_valid() {
        assert!(validate_id("test").is_ok());
        assert!(validate_id("test-extension").is_ok());
        assert!(validate_id("test_extension").is_ok());
        assert!(validate_id("test123").is_ok());
        assert!(validate_id("a").is_ok());
    }

    #[test]
    fn test_validate_id_invalid() {
        assert!(validate_id("").is_err());
        assert!(validate_id("123test").is_err()); // Starts with number
        assert!(validate_id("Test").is_err()); // Uppercase
        assert!(validate_id("test--ext").is_err()); // Consecutive hyphens
        assert!(validate_id("test-").is_err()); // Ends with hyphen
        assert!(validate_id("test ext").is_err()); // Space
    }

    #[test]
    fn test_validate_version_valid() {
        assert!(validate_version("1.0").is_ok());
        assert!(validate_version("1.0.0").is_ok());
        assert!(validate_version("0.1.0").is_ok());
        assert!(validate_version("10.20.30").is_ok());
        assert!(validate_version("1.0.0-alpha").is_ok());
        assert!(validate_version("1.0.0-alpha.1").is_ok());
        assert!(validate_version("1.0.0-beta2").is_ok());
    }

    #[test]
    fn test_validate_version_invalid() {
        assert!(validate_version("").is_err());
        assert!(validate_version("1").is_err()); // Missing minor
        assert!(validate_version("1.0.0.0").is_err()); // Too many parts
        assert!(validate_version("1.0.0-").is_err()); // Empty prerelease
        assert!(validate_version("01.0.0").is_err()); // Leading zero
        assert!(validate_version("v1.0.0").is_err()); // Leading 'v'
        assert!(validate_version("1.a.0").is_err()); // Non-numeric
    }
}
