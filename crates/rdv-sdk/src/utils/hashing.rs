//! Hashing Utilities

use sha2::{Sha256, Digest};

/// Compute SHA-256 hash of content and return as hex string
pub fn content_hash(content: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(content.as_bytes());
    hex::encode(hasher.finalize())
}

/// Compute SHA-256 hash of a string
pub fn hash_string(s: &str) -> String {
    content_hash(s)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_content_hash() {
        let hash = content_hash("hello world");
        assert_eq!(hash.len(), 64); // SHA-256 produces 64 hex chars

        // Same input should produce same hash
        assert_eq!(content_hash("hello world"), content_hash("hello world"));

        // Different input should produce different hash
        assert_ne!(content_hash("hello world"), content_hash("hello world!"));
    }

    #[test]
    fn test_known_hash() {
        // Known SHA-256 hash for "hello"
        let hash = content_hash("hello");
        assert_eq!(
            hash,
            "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824"
        );
    }
}
