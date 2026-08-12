import http.server
import importlib.util
import json
import os
import pathlib
import queue
import tempfile
import threading
import time
import types
import unittest


REPO_ROOT = pathlib.Path(__file__).resolve().parents[1]
SOURCE_PATH = pathlib.Path(os.environ.get("IR_LOGGER_PATH", REPO_ROOT / "ir-logger.py"))

try:
    import tkinter  # noqa: F401
except ImportError:
    tkinter = types.ModuleType("tkinter")
    tkinter.ttk = types.ModuleType("tkinter.ttk")
    tkinter.messagebox = types.ModuleType("tkinter.messagebox")
    tkinter.filedialog = types.ModuleType("tkinter.filedialog")
    tkinter.END = "end"
    tkinter.Toplevel = tkinter.Tk = tkinter.Label = tkinter.Entry = tkinter.Text = (
        tkinter.Button
    ) = tkinter.Radiobutton = object
    tkinter.StringVar = object
    tkinter.ttk.Combobox = object
    tkinter.messagebox.showerror = lambda *args, **kwargs: None
    tkinter.filedialog.asksaveasfilename = lambda **kwargs: ""
    tkinter.filedialog.askopenfilename = lambda **kwargs: ""
    import sys

    sys.modules["tkinter"] = tkinter
    sys.modules["tkinter.ttk"] = tkinter.ttk
    sys.modules["tkinter.messagebox"] = tkinter.messagebox
    sys.modules["tkinter.filedialog"] = tkinter.filedialog


spec = importlib.util.spec_from_file_location("ir_logger_under_test", SOURCE_PATH)
ir_logger = importlib.util.module_from_spec(spec)
spec.loader.exec_module(ir_logger)


class StatusLabel:
    def __init__(self):
        self.text = ""

    def config(self, **kwargs):
        self.text = kwargs["text"]


class FakeRoot:
    def __init__(self):
        self.callbacks = queue.Queue()
        self.after_calls = []

    def after(self, delay, callback):
        self.after_calls.append((delay, callback))
        self.callbacks.put(callback)

    def run_callbacks(self):
        while True:
            try:
                self.callbacks.get_nowait()()
            except queue.Empty:
                return


class SyncHarness:
    sync_entry = ir_logger.IRLoggerApp.sync_entry

    def __init__(self, config):
        self.sync_config = config
        self.root = FakeRoot()
        self.sync_status = StatusLabel()


class RequestHandler(http.server.BaseHTTPRequestHandler):
    def do_POST(self):
        length = int(self.headers.get("Content-Length", "0"))
        body = self.rfile.read(length)
        self.server.requests.append((dict(self.headers), body))
        self._respond()

    def do_GET(self):
        self.server.requests.append((dict(self.headers), b""))
        self._respond()

    def _respond(self):
        if self.server.redirect_to:
            self.send_response(302)
            self.send_header("Location", self.server.redirect_to)
            self.end_headers()
        else:
            self.send_response(self.server.response_code)
            self.end_headers()

    def log_message(self, format, *args):
        pass


class TestServer:
    def __init__(self, response_code=201, redirect_to=None, delay=0):
        self.server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), RequestHandler)
        self.server.requests = []
        self.server.response_code = response_code
        self.server.redirect_to = redirect_to
        self.server.delay = delay
        original = self.server.finish_request

        def delayed_finish(request, client_address):
            if self.server.delay:
                time.sleep(self.server.delay)
            original(request, client_address)

        self.server.finish_request = delayed_finish
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)

    @property
    def url(self):
        return f"http://127.0.0.1:{self.server.server_port}"

    def start(self):
        self.thread.start()

    def stop(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=2)


class DesktopSyncTests(unittest.TestCase):
    def setUp(self):
        self.tempdir = tempfile.TemporaryDirectory()
        self.old_config_path = ir_logger.SYNC_CONFIG_PATH
        ir_logger.SYNC_CONFIG_PATH = os.path.join(self.tempdir.name, "ir-logger-sync.json")

    def tearDown(self):
        ir_logger.SYNC_CONFIG_PATH = self.old_config_path
        self.tempdir.cleanup()

    def wait_for_status(self, harness, expected, timeout=2):
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            harness.root.run_callbacks()
            if harness.sync_status.text == expected or (
                expected.endswith("...") and harness.sync_status.text.startswith(expected[:-3])
            ):
                return
            time.sleep(0.01)
        harness.root.run_callbacks()
        self.assertEqual(harness.sync_status.text, expected)

    def test_redirect_is_rejected_without_forwarding_authorization(self):
        target = TestServer()
        target.start()
        redirect = TestServer(redirect_to=target.url.replace("127.0.0.1", "localhost") + "/api/v1/ingest")
        redirect.start()
        harness = SyncHarness({"server_url": redirect.url, "token": "secret-token"})
        try:
            harness.sync_entry("IR-redirect", False, "Discovery", "body", "2024-01-01T12:00:00+00:00")
            self.wait_for_status(harness, "Sync failed (saved locally)")
            self.assertEqual(target.server.requests, [])
            self.assertEqual(redirect.server.requests[0][0]["Authorization"], "Bearer secret-token")
        finally:
            redirect.stop()
            target.stop()

    def test_rejected_url_is_not_loaded_or_written(self):
        with open(ir_logger.SYNC_CONFIG_PATH, "w") as config:
            json.dump({"server_url": "http://evil.example", "token": "secret"}, config)
        self.assertIsNone(ir_logger.IRLoggerApp.load_sync_config(object()))
        with self.assertRaises(ValueError):
            ir_logger.write_sync_config("http://evil.example", "secret")
        with open(ir_logger.SYNC_CONFIG_PATH) as config:
            self.assertEqual(json.load(config)["server_url"], "http://evil.example")
        self.assertTrue(ir_logger.is_valid_server_url("https://example.test"))
        self.assertTrue(ir_logger.is_valid_server_url("http://localhost:8080"))
        self.assertFalse(ir_logger.is_valid_server_url("http://example.test"))

    def test_sync_config_is_private(self):
        ir_logger.write_sync_config("https://example.test", "secret")
        self.assertEqual(os.stat(ir_logger.SYNC_CONFIG_PATH).st_mode & 0o777, 0o600)
        os.chmod(ir_logger.SYNC_CONFIG_PATH, 0o644)
        ir_logger.write_sync_config("https://example.test", "new-secret")
        self.assertEqual(os.stat(ir_logger.SYNC_CONFIG_PATH).st_mode & 0o777, 0o600)

    def test_sync_network_call_does_not_block_and_updates_via_after(self):
        server = TestServer(delay=1)
        server.start()
        harness = SyncHarness({"server_url": server.url, "token": "secret"})
        try:
            started = time.monotonic()
            harness.sync_entry("IR-slow", True, "Timeline Event", "body", "2024-01-01T12:00:00Z")
            elapsed = time.monotonic() - started
            self.assertLess(elapsed, 0.3)
            self.assertEqual(harness.sync_status.text, "")
            self.wait_for_status(harness, "Synced ✓...")
            self.assertTrue(harness.root.after_calls)
        finally:
            server.stop()

    def test_blank_event_id_skips_sync(self):
        server = TestServer()
        server.start()
        harness = SyncHarness({"server_url": server.url, "token": "secret"})
        try:
            harness.sync_entry("", False, "Discovery", "body", "2024-01-01T12:00:00Z")
            self.wait_for_status(harness, "Sync skipped (no EventID)")
            self.assertEqual(server.server.requests, [])
        finally:
            server.stop()

    def test_payload_uses_utc_but_local_markdown_keeps_local_format(self):
        class Data:
            def get(self, start, end):
                return "body"

            def delete(self, start, end):
                pass

        class EventID:
            def get(self):
                return "IR-utc"

        server = TestServer()
        server.start()
        harness = types.SimpleNamespace(
            log_type=types.SimpleNamespace(get=lambda: "Timestamp Event"),
            category=types.SimpleNamespace(get=lambda: "Discovery"),
            data=Data(),
            event_id=EventID(),
            sync_config={"server_url": server.url, "token": "secret"},
            refresh_preview=lambda: None,
            update_past_events=lambda: None,
            root=FakeRoot(),
            sync_status=StatusLabel(),
        )
        harness.sync_entry = lambda **kwargs: ir_logger.IRLoggerApp.sync_entry(harness, **kwargs)
        filename = os.path.join(self.tempdir.name, "entry.md")
        try:
            ir_logger.IRLoggerApp.log_entry(harness, filename)
        finally:
            deadline = time.monotonic() + 2
            while not server.server.requests and time.monotonic() < deadline:
                time.sleep(0.01)
            server.stop()
        with open(filename) as entry:
            self.assertRegex(entry.read(), r"- \[\d{4}-\d{2}-\d{2} \d{2}:\d{2}\] ubuntu: body")
        self.assertEqual(len(server.server.requests), 1)
        payload = json.loads(server.server.requests[0][1])
        self.assertRegex(payload["occurred_at"], r"Z$")

    def test_no_config_still_writes_locally_without_network(self):
        class Data:
            def get(self, start, end):
                return "body"

            def delete(self, start, end):
                pass

        harness = types.SimpleNamespace(
            log_type=types.SimpleNamespace(get=lambda: "Technical Details"),
            category=types.SimpleNamespace(get=lambda: "Discovery"),
            data=Data(),
            event_id=types.SimpleNamespace(get=lambda: "IR-offline"),
            sync_config=None,
            refresh_preview=lambda: None,
            update_past_events=lambda: None,
            root=FakeRoot(),
            sync_status=StatusLabel(),
        )
        harness.sync_entry = lambda **kwargs: ir_logger.IRLoggerApp.sync_entry(harness, **kwargs)
        filename = os.path.join(self.tempdir.name, "entry.md")
        ir_logger.IRLoggerApp.log_entry(harness, filename)
        self.assertTrue(os.path.exists(filename))
        with open(filename) as entry:
            self.assertIn("body", entry.read())


if __name__ == "__main__":
    unittest.main(verbosity=2)
