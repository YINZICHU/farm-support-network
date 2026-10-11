-- Initial production provisioning only. Existing storage requires explicit migration.
CREATE UNIQUE INDEX IF NOT EXISTS fs_user_activation_claim ON user(activationClaimId)
WHERE activationClaimId IS NOT NULL;
