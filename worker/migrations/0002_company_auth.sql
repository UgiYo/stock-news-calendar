CREATE TABLE IF NOT EXISTS company_auth_transactions(
 id TEXT PRIMARY KEY,state TEXT NOT NULL,challenge TEXT NOT NULL,expires_at INTEGER NOT NULL,
 status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','verified','used')),
 subject TEXT,label TEXT,jti TEXT UNIQUE,code_hash TEXT UNIQUE,code_expires_at INTEGER
);
CREATE INDEX IF NOT EXISTS company_auth_expiry ON company_auth_transactions(expires_at);
CREATE TABLE IF NOT EXISTS company_auth_limits(ip_hash TEXT NOT NULL,bucket INTEGER NOT NULL,count INTEGER NOT NULL,PRIMARY KEY(ip_hash,bucket));
