use super::model::PasswordPolicy;
use rand::{rngs::OsRng, seq::SliceRandom, Rng};

pub fn generate(policy: &PasswordPolicy) -> Result<String, String> {
    if !(4..=128).contains(&policy.length)
        || policy.symbol_chars.len() > 128
        || (policy.symbols
            && !policy
                .symbol_chars
                .chars()
                .all(|c| c.is_ascii_punctuation()))
    {
        return Err("VAULT_POLICY".into());
    }
    let filter = |chars: &str| -> Vec<char> {
        chars
            .chars()
            .filter(|c| c.is_ascii_graphic() && (!policy.avoid_ambiguous || !"0Oo1Il".contains(*c)))
            .collect()
    };
    let mut groups = vec![];
    for (enabled, chars) in [
        (policy.uppercase, "ABCDEFGHIJKLMNOPQRSTUVWXYZ"),
        (policy.lowercase, "abcdefghijklmnopqrstuvwxyz"),
        (policy.digits, "0123456789"),
        (policy.symbols, policy.symbol_chars.as_str()),
    ] {
        if enabled {
            let mut group = filter(chars);
            group.sort_unstable();
            group.dedup();
            if group.is_empty() {
                return Err("VAULT_POLICY".into());
            }
            groups.push(group);
        }
    }
    if groups.is_empty() || groups.len() > policy.length {
        return Err("VAULT_POLICY".into());
    }
    let mut pool: Vec<char> = groups.iter().flatten().copied().collect();
    pool.sort_unstable();
    pool.dedup();
    // Rejection sampling preserves a uniform distribution over valid passwords.
    for _ in 0..10000 {
        let mut result = Vec::with_capacity(policy.length);
        for _ in 0..policy.length {
            result.push(pool[OsRng.gen_range(0..pool.len())]);
        }
        if groups
            .iter()
            .all(|group| result.iter().any(|c| group.contains(c)))
        {
            result.shuffle(&mut OsRng);
            return Ok(result.into_iter().collect());
        }
    }
    Err("VAULT_POLICY".into())
}
