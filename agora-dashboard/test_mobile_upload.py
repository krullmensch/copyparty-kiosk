#!/usr/bin/env python3
"""
Tests for the Mobile-Upload-via-QR routes (Task MU-4).

Covers server.py's GET /up and POST /up/upload against the assertions
defined in RUN-STATE.md's MU-4 handoff:
  - GET /up -> 200, text/html, non-empty body
  - POST /up/upload with a mocked _copyparty_bput -> ok:true, uploaded
    contains the filename, bput called with act=bput semantics (vpath,
    filename, data)
  - POST /up/upload with multiple files -> all filenames in uploaded
  - POST /up/upload with no file -> real behaviour (ok:false, 400)
  - Event-logging failure/no-session must not fail the upload

Uses stdlib unittest + Flask's test_client() (no new dependency).
"""
from __future__ import annotations

import io
import unittest
from unittest import mock

import server


class MobileUploadPageTests(unittest.TestCase):
    def setUp(self) -> None:
        self.client = server.app.test_client()

    def test_get_up_returns_html_page(self) -> None:
        resp = self.client.get("/up")
        self.assertEqual(resp.status_code, 200)
        self.assertIn("text/html", resp.content_type)
        self.assertTrue(len(resp.data) > 0)


class MobileUploadRouteTests(unittest.TestCase):
    def setUp(self) -> None:
        self.client = server.app.test_client()

    def test_single_file_upload_ok(self) -> None:
        with mock.patch.object(server, "_copyparty_bput") as bput, mock.patch.object(
            server, "_current_session_id", return_value=None
        ):
            resp = self.client.post(
                "/up/upload",
                data={"file": (io.BytesIO(b"hello world"), "photo.jpg")},
                content_type="multipart/form-data",
            )
            self.assertEqual(resp.status_code, 200)
            body = resp.get_json()
            self.assertTrue(body["ok"])
            self.assertIn("photo.jpg", body["uploaded"])
            bput.assert_called_once_with(server.MOBILE_INBOX, "photo.jpg", b"hello world")

    def test_multiple_files_all_uploaded(self) -> None:
        with mock.patch.object(server, "_copyparty_bput") as bput, mock.patch.object(
            server, "_current_session_id", return_value=None
        ):
            resp = self.client.post(
                "/up/upload",
                data={
                    "file": [
                        (io.BytesIO(b"aaa"), "a.jpg"),
                        (io.BytesIO(b"bbb"), "b.jpg"),
                        (io.BytesIO(b"ccc"), "c.txt"),
                    ]
                },
                content_type="multipart/form-data",
            )
            self.assertEqual(resp.status_code, 200)
            body = resp.get_json()
            self.assertTrue(body["ok"])
            self.assertCountEqual(body["uploaded"], ["a.jpg", "b.jpg", "c.txt"])
            self.assertEqual(bput.call_count, 3)

    def test_no_file_returns_error(self) -> None:
        # matches real behaviour in server.py: uploaded stays empty ->
        # ok=False and HTTP 400 (no separate "no file" branch exists).
        with mock.patch.object(server, "_copyparty_bput") as bput:
            resp = self.client.post(
                "/up/upload",
                data={},
                content_type="multipart/form-data",
            )
            self.assertEqual(resp.status_code, 400)
            body = resp.get_json()
            self.assertFalse(body["ok"])
            self.assertEqual(body["uploaded"], [])
            bput.assert_not_called()

    def test_upload_succeeds_when_event_logging_fails(self) -> None:
        # no active session (_current_session_id -> None) must NOT fail
        # the upload -- event logging is skipped, upload still ok:true.
        with mock.patch.object(server, "_copyparty_bput") as bput, mock.patch.object(
            server, "_current_session_id", return_value=None
        ):
            resp = self.client.post(
                "/up/upload",
                data={"file": (io.BytesIO(b"data"), "no-session.jpg")},
                content_type="multipart/form-data",
            )
            self.assertEqual(resp.status_code, 200)
            body = resp.get_json()
            self.assertTrue(body["ok"])
            self.assertIn("no-session.jpg", body["uploaded"])
            bput.assert_called_once()

    def test_upload_succeeds_when_event_insert_raises(self) -> None:
        # active session but poller.connect/insert_event blows up -- also
        # must not fail the upload (server.py wraps event logging in
        # try/except Exception around the whole block).
        with mock.patch.object(server, "_copyparty_bput") as bput, mock.patch.object(
            server, "_current_session_id", return_value=1
        ), mock.patch.object(server.poller, "connect", side_effect=RuntimeError("db locked")):
            resp = self.client.post(
                "/up/upload",
                data={"file": (io.BytesIO(b"data"), "event-fails.jpg")},
                content_type="multipart/form-data",
            )
            self.assertEqual(resp.status_code, 200)
            body = resp.get_json()
            self.assertTrue(body["ok"])
            self.assertIn("event-fails.jpg", body["uploaded"])
            bput.assert_called_once()


if __name__ == "__main__":
    unittest.main()
