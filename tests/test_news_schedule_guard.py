import datetime as dt
import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location('guard', Path(__file__).parents[1] / 'scripts/news_schedule_guard.py')
guard = importlib.util.module_from_spec(spec)
spec.loader.exec_module(guard)


class ScheduleGuardTests(unittest.TestCase):
    def setUp(self):
        self.now = dt.datetime.fromisoformat('2026-10-07T00:17:00+00:00')
        self.run = dict(id=1, event='schedule', head_branch='main', status='completed', path='.github/workflows/news.yml', created_at='2026-10-06T22:17:00Z')
        self.jobs = [{'steps': [{'name': guard.NEWS_STEP, 'conclusion': 'success', 'completed_at': '2026-10-06T22:22:00Z'}]}]
    def test_external_scheduler_uses_guard_but_manual_requests_still_run(self):
        self.assertTrue(guard.guarded_event('push', 'true'))
        self.assertTrue(guard.guarded_event('schedule'))
        self.assertFalse(guard.guarded_event('push', 'false'))
        self.assertFalse(guard.guarded_event('workflow_dispatch', 'true'))
    def test_external_daily_success_suppresses_later_cron_retry(self):
        run = {**self.run, 'event': 'push'}
        self.assertEqual(guard.should_collect([run], lambda _: self.jobs, self.now, 2), (False, 1))
    def test_external_daily_failure_allows_next_scheduler_attempt(self):
        run = {**self.run, 'event': 'push', 'conclusion': 'failure'}
        jobs = [{'steps': [{'name': guard.NEWS_STEP, 'conclusion': 'failure', 'completed_at': '2026-10-06T22:22:00Z'}]}]
        self.assertEqual(guard.should_collect([run], lambda _: jobs, self.now, 2), (True, None))
    def test_successful_morning_news_skips_backup(self):
        self.assertEqual(guard.should_collect([self.run], lambda _: self.jobs, self.now, 2), (False, 1))
    def test_queued_manual_prior_day_or_other_branch_does_not_skip(self):
        for delta in [{'event': 'workflow_dispatch'}, {'created_at': '2026-10-06T17:41:00Z'}, {'head_branch': 'feature'}, {'id': 2}, {'status': 'queued'}, {'path': '.github/workflows/podcasts.yml'}]:
            self.assertEqual(guard.should_collect([{**self.run, **delta}], lambda _: self.jobs, self.now, 2), (True, None))
    def test_news_failure_or_skipped_news_does_not_suppress_retry(self):
        for outcome in ['failure', 'skipped', 'cancelled']:
            jobs = [{'steps': [{'name': guard.NEWS_STEP, 'conclusion': outcome, 'completed_at': '2026-10-06T22:22:00Z'}]}]
            self.assertEqual(guard.should_collect([self.run], lambda _: jobs, self.now, 2), (True, None))
    def test_news_success_counts_even_if_later_auxiliary_step_fails(self):
        run = {**self.run, 'conclusion': 'failure'}
        self.assertFalse(guard.should_collect([run], lambda _: self.jobs, self.now, 2)[0])
    def test_news_success_counts_while_maintenance_is_still_running(self):
        self.assertFalse(guard.should_collect([{**self.run, 'status': 'in_progress'}], lambda _: self.jobs, self.now, 2)[0])
    def test_cutoff_crosses_utc_date_and_pre_dawn_uses_previous_morning(self):
        self.assertEqual(guard.morning_cutoff(self.now).isoformat(), '2026-10-06T22:00:00+00:00')
        self.assertEqual(guard.morning_cutoff(dt.datetime.fromisoformat('2026-10-06T17:00:00+00:00')).isoformat(), '2026-10-05T22:00:00+00:00')

if __name__ == '__main__':
    unittest.main()
