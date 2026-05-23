-- Deduplicate any existing rows that would violate the new unique constraint
-- (keeps the most recent snapshot per user+plan+month).
DELETE FROM "ComplianceSnapshot" a
USING "ComplianceSnapshot" b
WHERE a."userId" = b."userId"
  AND a."planId" = b."planId"
  AND a."periodStart" = b."periodStart"
  AND a."createdAt" < b."createdAt";

-- One snapshot per (user, plan, month) — keeps spend compliance idempotent.
CREATE UNIQUE INDEX "ComplianceSnapshot_userId_planId_periodStart_key"
  ON "ComplianceSnapshot"("userId", "planId", "periodStart");
