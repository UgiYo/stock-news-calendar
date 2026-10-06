"""Skip a redundant scheduled collection only after today's news step really succeeded.

Uses GitHub run/job metadata, not D1 writes. API failures deliberately allow recovery.
Manual daily/queued requests and configuration pushes are never skipped.
"""
import datetime as dt
import json
import os
import urllib.error
import urllib.request

TW = dt.timezone(dt.timedelta(hours=8))
NEWS_STEP = 'Collect news and process queued summaries'


def morning_cutoff(now):
    local = now.astimezone(TW)
    cutoff = local.replace(hour=6, minute=0, second=0, microsecond=0)
    if local < cutoff:
        cutoff -= dt.timedelta(days=1)
    return cutoff.astimezone(dt.timezone.utc)


def timestamp(value):
    return dt.datetime.fromisoformat(value.replace('Z', '+00:00'))


def candidate(run, cutoff, current_id):
    return (
        str(run.get('id')) != str(current_id)
        and run.get('event') in ('schedule', 'push')
        and run.get('head_branch') == 'main'
        and run.get('status') == 'completed'
        and run.get('path') == '.github/workflows/news.yml'
        and timestamp(run['created_at']) >= cutoff
    )


def collected(jobs, cutoff):
    return any(
        step.get('name') == NEWS_STEP
        and step.get('conclusion') == 'success'
        and step.get('completed_at')
        and timestamp(step['completed_at']) >= cutoff
        for job in jobs for step in job.get('steps', [])
    )


def should_collect(runs, get_jobs, now, current_id):
    cutoff = morning_cutoff(now)
    for run in runs:
        if candidate(run, cutoff, current_id) and collected(get_jobs(run['id']), cutoff):
            return False, run['id']
    return True, None


def main():
    run_news, previous = True, None
    if os.environ.get('GITHUB_EVENT_NAME') == 'schedule':
        try:
            repo = os.environ['GITHUB_REPOSITORY']
            token = os.environ['GH_TOKEN']
            def api(path):
                request = urllib.request.Request(
                    'https://api.github.com/repos/' + repo + path,
                    headers={'Authorization': 'Bearer ' + token,
                             'Accept': 'application/vnd.github+json',
                             'X-GitHub-Api-Version': '2022-11-28',
                             'User-Agent': 'stock-news-calendar-schedule-guard'},
                )
                with urllib.request.urlopen(request, timeout=20) as response:
                    return json.load(response)
            # The daily workflow is serialized by its existing concurrency group.
            runs = api('/actions/workflows/news.yml/runs?branch=main&per_page=100')['workflow_runs']
            run_news, previous = should_collect(
                runs,
                lambda run_id: api('/actions/runs/' + str(run_id) + '/jobs?per_page=100')['jobs'],
                dt.datetime.now(dt.timezone.utc), os.environ['GITHUB_RUN_ID'],
            )
        except (KeyError, ValueError, TypeError, OSError, urllib.error.URLError):
            # Do not expose URLs, tokens, response bodies or exception text.
            print('::warning::Cannot verify earlier collection; continue with recovery run.')
    value = 'true' if run_news else 'false'
    with open(os.environ['GITHUB_OUTPUT'], 'a', encoding='utf-8') as output:
        output.write('run_news=' + value + '\n')
    with open(os.environ['GITHUB_STEP_SUMMARY'], 'a', encoding='utf-8') as summary:
        summary.write('## Daily news collection\n\n')
        summary.write('Collect news now.\n' if run_news else 'News step already succeeded this morning in run ' + str(previous) + '; skip redundant collection.\n')
    print('Run news:', value)


if __name__ == '__main__':
    main()
