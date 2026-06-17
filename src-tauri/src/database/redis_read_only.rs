//! Best-effort read-only allowlist for Redis commands.
//!
//! Redis has no per-connection read-only mode, so — unlike the SQL engines —
//! read-only is enforced here by an allowlist rather than by the server.
//! Anything not explicitly listed is denied (fail closed): an unlisted safe
//! read is wrongly rejected, but no write ever slips through.

/// Returns `true` if `query` is a recognised read-only Redis command.
///
/// Single-word read commands are allowed by name. Multi-subcommand families
/// (`CLIENT`, `MEMORY`, `OBJECT`, `XINFO`) are validated by subcommand so that
/// administrative variants like `CLIENT KILL` or `MEMORY PURGE` are rejected
/// even though the family name itself reads.
pub fn is_read_only_redis_command(query: &str) -> bool {
    let mut parts = query.split_whitespace();
    let command = parts.next().unwrap_or("").to_uppercase();
    let subcommand = parts.next().unwrap_or("").to_uppercase();

    match command.as_str() {
        // Multi-subcommand families: only safe subcommands are read-only.
        "CLIENT" => matches!(
            subcommand.as_str(),
            "ID" | "GETNAME" | "INFO" | "LIST" | "GETREDIR" | "TRACKINGINFO"
        ),
        "MEMORY" => matches!(
            subcommand.as_str(),
            "USAGE" | "STATS" | "DOCTOR" | "MALLOC-STATS" | "HELP"
        ),
        "OBJECT" => matches!(
            subcommand.as_str(),
            "ENCODING" | "REFCOUNT" | "IDLETIME" | "FREQ" | "HELP"
        ),
        // All XINFO subcommands are read-only.
        "XINFO" => true,
        // Plain read-only commands.
        _ => matches!(
            command.as_str(),
            // String / bitmap commands
            "GET" | "MGET" | "STRLEN" | "GETRANGE" | "SUBSTR" | "LCS"
            | "BITCOUNT" | "BITPOS" | "GETBIT" | "BITFIELD_RO"
            // Key commands
            | "EXISTS" | "TYPE" | "TTL" | "PTTL" | "EXPIRETIME" | "PEXPIRETIME"
            | "KEYS" | "SCAN" | "RANDOMKEY" | "DUMP" | "TOUCH" | "SORT_RO"
            // List commands
            | "LLEN" | "LRANGE" | "LINDEX" | "LPOS"
            // Hash commands
            | "HGET" | "HGETALL" | "HKEYS" | "HVALS" | "HLEN"
            | "HEXISTS" | "HMGET" | "HSCAN" | "HRANDFIELD" | "HSTRLEN"
            // Set commands
            | "SCARD" | "SISMEMBER" | "SMISMEMBER" | "SMEMBERS"
            | "SRANDMEMBER" | "SSCAN" | "SINTER" | "SUNION" | "SDIFF"
            | "SINTERCARD"
            // Sorted set commands
            | "ZCARD" | "ZCOUNT" | "ZRANGE" | "ZRANGEBYSCORE"
            | "ZREVRANGE" | "ZREVRANGEBYSCORE" | "ZRANK" | "ZREVRANK"
            | "ZSCORE" | "ZMSCORE" | "ZSCAN" | "ZRANGEBYLEX"
            | "ZREVRANGEBYLEX" | "ZLEXCOUNT" | "ZRANDMEMBER"
            // Server / connection commands
            | "DBSIZE" | "INFO" | "PING" | "ECHO" | "TIME"
            // Stream commands
            | "XLEN" | "XRANGE" | "XREVRANGE" | "XREAD" | "XPENDING"
            // HyperLogLog
            | "PFCOUNT"
            // Geo commands
            | "GEOSEARCH" | "GEOPOS" | "GEODIST" | "GEOHASH"
            | "GEORADIUS_RO" | "GEORADIUSBYMEMBER_RO"
            // Misc
            | "WAIT"
        ),
    }
}

#[cfg(test)]
mod tests {
    use super::is_read_only_redis_command;

    #[test]
    fn allows_plain_read_commands() {
        assert!(is_read_only_redis_command("GET mykey"));
        assert!(is_read_only_redis_command("  get mykey"));
        assert!(is_read_only_redis_command("KEYS *"));
        assert!(is_read_only_redis_command("SCAN 0 MATCH * COUNT 100"));
        assert!(is_read_only_redis_command("LRANGE mylist 0 -1"));
        assert!(is_read_only_redis_command("HGETALL myhash"));
        assert!(is_read_only_redis_command("INFO server"));
        assert!(is_read_only_redis_command("XLEN mystream"));
        // Read-only variants of commands that can otherwise write via STORE.
        assert!(is_read_only_redis_command("SORT_RO mylist"));
        assert!(is_read_only_redis_command("BITCOUNT mykey"));
    }

    #[test]
    fn blocks_write_commands() {
        assert!(!is_read_only_redis_command("SET mykey value"));
        assert!(!is_read_only_redis_command("DEL mykey"));
        assert!(!is_read_only_redis_command("FLUSHDB"));
        assert!(!is_read_only_redis_command("LPUSH mylist value"));
        assert!(!is_read_only_redis_command("HSET myhash field value"));
        assert!(!is_read_only_redis_command("EXPIRE mykey 100"));
        // Variants that can write via STORE/DESTINATION are not read-only.
        assert!(!is_read_only_redis_command("SORT mylist STORE dest"));
        assert!(!is_read_only_redis_command(
            "GEORADIUS k 0 0 1 km STORE dest"
        ));
    }

    #[test]
    fn blocks_admin_subcommands_but_allows_read_subcommands() {
        // Administrative subcommands of read-ish families are rejected.
        assert!(!is_read_only_redis_command("CLIENT KILL ID 5"));
        assert!(!is_read_only_redis_command("CLIENT PAUSE 1000"));
        assert!(!is_read_only_redis_command("CLIENT NO-EVICT ON"));
        assert!(!is_read_only_redis_command("MEMORY PURGE"));
        // Read subcommands of the same families are allowed.
        assert!(is_read_only_redis_command("CLIENT INFO"));
        assert!(is_read_only_redis_command("CLIENT LIST"));
        assert!(is_read_only_redis_command("MEMORY USAGE mykey"));
        assert!(is_read_only_redis_command("OBJECT ENCODING mykey"));
        assert!(is_read_only_redis_command("XINFO STREAM mystream"));
    }
}
