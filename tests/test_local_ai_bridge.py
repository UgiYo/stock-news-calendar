import importlib.util
import json
import threading
import unittest
import urllib.request
import urllib.error
from pathlib import Path
from http.server import ThreadingHTTPServer

spec = importlib.util.spec_from_file_location('bridge', Path(__file__).parents[1] / 'tools/local_ai_bridge.py')
bridge = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bridge)

class BridgeTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = ThreadingHTTPServer(('127.0.0.1', 0), bridge.Handler)
        cls.server.ca_file = None
        cls.url = 'http://127.0.0.1:' + str(cls.server.server_port)
        bridge.ORIGINS.add(cls.url)
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()
    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()
    def status(self, request):
        try:
            return urllib.request.urlopen(request).status
        except urllib.error.HTTPError as error:
            return error.code
    def test_local_page_and_origin_protection(self):
        self.assertEqual(self.status(self.url), 200)
        self.assertEqual(self.status(urllib.request.Request(self.url, headers={'Origin': 'https://evil.example'})), 403)
        self.assertEqual(self.status(urllib.request.Request(self.url, headers={'Host': 'evil.example'})), 403)
        request = urllib.request.Request(self.url + '/relay', method='OPTIONS', headers={'Origin': 'https://ugiyo.github.io'})
        with urllib.request.urlopen(request) as response:
            self.assertEqual(response.headers['Access-Control-Allow-Origin'], 'https://ugiyo.github.io')
    def test_pairing_before_upstream_and_input_rejection(self):
        request = urllib.request.Request(self.url + '/relay', data=b'{}', headers={'Origin': 'https://ugiyo.github.io'}, method='POST')
        self.assertEqual(self.status(request), 401)
        request.add_header('X-Local-AI-Token', bridge.TOKEN)
        self.assertEqual(self.status(request), 400)
    def test_health_and_authenticated_pairing(self):
        with urllib.request.urlopen(self.url + '/health') as response:
            data = json.load(response)
            self.assertEqual(data['service'], 'stock-news-local-ai')
            self.assertNotIn(bridge.TOKEN, json.dumps(data))
        request = urllib.request.Request(self.url + '/pair', data=b'', method='POST')
        self.assertEqual(self.status(request), 401)
        request.add_header('X-Local-AI-Token', bridge.TOKEN)
        with urllib.request.urlopen(request) as response:
            self.assertTrue(json.load(response)['paired'])

    def test_extracts_complete_body_and_rejects_teaser_or_paywall(self):
        text = '首段事件內容。' * 60 + '最後一段重要數據。'
        html = '<html><nav>menu</nav><div class="centralContent"><p>' + text + '</p></div><footer>other stories</footer></html>'
        extracted = bridge.extract_article(html)
        self.assertIn('最後一段重要數據', extracted)
        self.assertNotIn('other stories', extracted)
        self.assertNotIn('menu', extracted)
        self.assertEqual(bridge.extract_article('<script type="application/ld+json">' + json.dumps({'@type':'NewsArticle','articleBody':text}) + '</script>'), text)
        for page in ('<div class="centralContent">teaser</div>', '<script type="application/ld+json">{"isAccessibleForFree":false}</script>' + html):
            with self.assertRaises(ValueError):
                bridge.extract_article(page)

    def test_article_reading_requires_pairing(self):
        request = urllib.request.Request(self.url + '/articles', data=b'{}', method='POST')
        self.assertEqual(self.status(request), 401)
        request.add_header('X-Local-AI-Token', bridge.TOKEN)
        self.assertEqual(self.status(request), 422)

    def test_target_validation_and_secret_location(self):
        c = {'provider': 'litellm', 'endpoint': 'https://company.example/v1', 'model': 'model', 'key': 'secret-value'}
        request = bridge.target_request(c, 'news')
        self.assertEqual(request.full_url, 'https://company.example/v1/chat/completions')
        self.assertEqual(request.get_header('Authorization'), 'Bearer secret-value')
        self.assertNotIn(b'secret-value', request.data)
        for url in ('http://company.example', 'https://news-calendar-api.pages.dev', 'https://u:p@company.example', 'https://company.example?key=x'):
            with self.assertRaises(ValueError):
                bridge.target_request({**c, 'endpoint': url}, 'news')

if __name__ == '__main__':
    unittest.main()
