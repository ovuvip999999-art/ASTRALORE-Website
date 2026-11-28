from pathlib import Path
import unittest


MIGRATION = Path(__file__).resolve().parents[1] / "migrations" / "0010_astra_generation_jobs.sql"


class QueueMigrationContractTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.sql = MIGRATION.read_text(encoding="utf-8").lower()

    def test_private_table_has_owner_scoped_rls(self):
        self.assertIn("alter table public.astra_generation_jobs enable row level security", self.sql)
        self.assertIn("auth.uid() = user_id", self.sql)
        self.assertIn("grant select on public.astra_generation_jobs to authenticated", self.sql)
        self.assertIn("revoke all on public.astra_generation_jobs from anon, authenticated", self.sql)

    def test_worker_rpcs_are_service_role_only(self):
        for function in (
            "astra_enqueue_generation_job",
            "astra_claim_generation_jobs",
            "astra_heartbeat_generation_job",
            "astra_complete_generation_job",
            "astra_fail_generation_job",
        ):
            self.assertIn("function public." + function, self.sql)
            self.assertIn("to service_role", self.sql)
        self.assertIn("from public, anon, authenticated", self.sql)

    def test_claim_uses_atomic_skip_locked(self):
        self.assertIn("for update skip locked", self.sql)
        self.assertIn("lease_expires_at", self.sql)
        self.assertIn("lease_token", self.sql)

    def test_queue_admission_is_bounded_and_idempotent(self):
        self.assertIn(">= 2", self.sql)
        self.assertIn(">= 100", self.sql)
        self.assertIn("unique (user_id, idempotency_key)", self.sql)
        self.assertIn("idempotency key was already used for a different request", self.sql)

    def test_user_cancel_is_authenticated_and_owner_scoped(self):
        self.assertIn("function public.astra_cancel_generation_job", self.sql)
        self.assertIn("if auth.uid() is null", self.sql)
        self.assertIn("user_id = auth.uid()", self.sql)
        self.assertIn("to authenticated", self.sql)

    def test_output_metadata_has_size_and_dimension_bounds(self):
        self.assertIn("536870912", self.sql)
        self.assertIn("16384", self.sql)
        self.assertIn("100000000", self.sql)
        self.assertIn("120000", self.sql)


if __name__ == "__main__":
    unittest.main()
