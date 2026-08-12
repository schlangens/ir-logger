import tkinter as tk
from tkinter import ttk, messagebox, filedialog
import datetime
import json
import os
import shutil
import re
import getpass  # To retrieve the username
import urllib.request
import urllib.parse
import threading

try:
    from PIL import ImageGrab, Image
    pillow_installed = True
except ImportError:
    pillow_installed = False

# Optional sync configuration, stored next to this script (git-ignored).
# Absent or invalid means sync is simply off; v1 works fully offline.
SYNC_CONFIG_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "ir-logger-sync.json")
SYNC_TIMEOUT_SECONDS = 5


class NoRedirectHandler(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


SYNC_OPENER = urllib.request.build_opener(NoRedirectHandler)


def is_valid_server_url(server_url):
    """Allow HTTPS, plus HTTP for local development hosts only."""
    try:
        parsed = urllib.parse.urlsplit(server_url)
    except ValueError:
        return False
    if not parsed.netloc or not parsed.hostname or parsed.username or parsed.password:
        return False
    if parsed.scheme == "https":
        return True
    return parsed.scheme == "http" and parsed.hostname in {"localhost", "127.0.0.1", "::1"}


def write_sync_config(server_url, token):
    """Persist sync settings with permissions suitable for the bearer token."""
    server_url = server_url.strip().rstrip("/")
    token = token.strip()
    if not is_valid_server_url(server_url):
        raise ValueError("Server URL must use HTTPS (HTTP is allowed only for localhost).")
    if not token:
        raise ValueError("API token cannot be empty.")
    config = json.dumps({"server_url": server_url, "token": token}, indent=2).encode("utf-8")
    fd = os.open(SYNC_CONFIG_PATH, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    try:
        os.chmod(SYNC_CONFIG_PATH, 0o600)
        with os.fdopen(fd, "wb") as f:
            fd = None
            f.write(config)
    finally:
        if fd is not None:
            os.close(fd)


def normalize_utc(value):
    """Return an aware ISO 8601 timestamp normalized to UTC with a Z suffix."""
    if isinstance(value, str):
        value = datetime.datetime.fromisoformat(value)
    if value.tzinfo is None:
        value = value.astimezone()
    return value.astimezone(datetime.timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def build_ingest_payload(event_id, is_timeline, category, body, occurred_at):
    payload = {
        "incident_ref": event_id,
        "kind": "timeline" if is_timeline else "technical",
        "body": body,
        "occurred_at": normalize_utc(occurred_at),
        "author_name": getpass.getuser(),
    }
    if not is_timeline:
        payload["category"] = category
    return payload


def post_ingest(server_url, token, payload):
    request = urllib.request.Request(
        f"{server_url.rstrip('/')}/api/v1/ingest",
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {token}",
        },
        method="POST",
    )
    with SYNC_OPENER.open(request, timeout=SYNC_TIMEOUT_SECONDS) as response:
        if not 200 <= response.status < 300:
            raise RuntimeError(f"unexpected HTTP status: {response.status}")

# Categories for Technical Details
TECH_CATEGORIES = [
    "Initial Access", "Execution", "Persistence", "Scheduled Tasks",
    "Privilege Escalation", "Defense Evasion", "Credential Access", "Discovery",
    "Lateral Movement", "Command and Control", "Exfiltration"
]

class IRLoggerApp:
    def __init__(self, root):
        self.root = root
        self.root.title("Incident Response Logger")

        # Event ID with Dropdown for Past Event IDs
        tk.Label(root, text="EventID:").grid(row=0, column=0, padx=5, pady=5)
        self.event_id = tk.Entry(root, width=20)
        self.event_id.grid(row=0, column=1, padx=5, pady=5)
        tk.Label(root, text="Past Event IDs:").grid(row=0, column=2, padx=5, pady=5)
        self.past_events = ttk.Combobox(root, state="readonly", width=15)
        self.past_events.grid(row=0, column=3, padx=5, pady=5)
        self.update_past_events()
        self.past_events.bind("<<ComboboxSelected>>", self.load_selected_event)

        # Log Type
        tk.Label(root, text="Log Type:").grid(row=1, column=0, padx=5, pady=5)
        self.log_type = tk.StringVar(value="Technical Details")
        tk.Radiobutton(root, text="Technical Details", variable=self.log_type, value="Technical Details", command=self.toggle_category).grid(row=1, column=1, sticky="w")
        tk.Radiobutton(root, text="Timeline Event", variable=self.log_type, value="Timestamp Event", command=self.toggle_category).grid(row=1, column=1, sticky="e")

        # Category Dropdown
        self.category_label = tk.Label(root, text="Category:")
        self.category_label.grid(row=2, column=0, padx=5, pady=5)
        self.category = ttk.Combobox(root, values=TECH_CATEGORIES, state="readonly")
        self.category.grid(row=2, column=1, padx=5, pady=5)
        self.category.set(TECH_CATEGORIES[0])

        # Data Entry
        tk.Label(root, text="Details:").grid(row=3, column=0, padx=5, pady=5)
        self.data = tk.Text(root, height=4, width=40)
        self.data.grid(row=3, column=1, padx=5, pady=5)

        # Buttons
        tk.Button(root, text="Add File", command=self.add_file).grid(row=4, column=0, padx=5, pady=5)
        tk.Button(root, text="Paste Image", command=self.paste_image).grid(row=4, column=1, padx=5, pady=5)

        # Markdown Preview
        tk.Label(root, text="Current Report:").grid(row=5, column=0, padx=5, pady=5)
        self.preview = tk.Text(root, height=10, width=50, state="disabled")
        self.preview.grid(row=5, column=1, padx=5, pady=5)
        tk.Button(root, text="Refresh Preview", command=self.refresh_preview).grid(row=5, column=2, padx=5, pady=5)

        # Submit Buttons
        tk.Button(root, text="Save", command=self.save_entry).grid(row=7, column=0, pady=10)
        tk.Button(root, text="Save As", command=self.save_entry_as).grid(row=7, column=1, pady=10)
        tk.Button(root, text="Sync Settings", command=self.open_sync_settings).grid(row=7, column=2, pady=10)

        self.sync_status = tk.Label(root, text="", anchor="w")
        self.sync_status.grid(row=8, column=0, columnspan=3, padx=5, sticky="w")

        self.sync_config = self.load_sync_config()

        self.update_past_events()

    def load_sync_config(self):
        """Loads sync settings if present and usable; anything else means sync is off."""
        try:
            with open(SYNC_CONFIG_PATH, "r") as f:
                config = json.load(f)
            server_url = str(config["server_url"]).strip().rstrip("/")
            token = str(config["token"]).strip()
            if server_url and token and is_valid_server_url(server_url):
                return {"server_url": server_url, "token": token}
        except Exception:
            pass
        return None

    def open_sync_settings(self):
        """Dialog for the optional server base URL and API token."""
        dialog = tk.Toplevel(self.root)
        dialog.title("Sync Settings")
        dialog.transient(self.root)

        tk.Label(dialog, text="Server base URL:").grid(row=0, column=0, padx=5, pady=5, sticky="e")
        url_entry = tk.Entry(dialog, width=34)
        url_entry.grid(row=0, column=1, padx=5, pady=5)
        tk.Label(dialog, text="API token:").grid(row=1, column=0, padx=5, pady=5, sticky="e")
        token_entry = tk.Entry(dialog, width=34, show="*")
        token_entry.grid(row=1, column=1, padx=5, pady=5)

        if self.sync_config:
            url_entry.insert(0, self.sync_config["server_url"])
            token_entry.insert(0, self.sync_config["token"])

        tk.Label(
            dialog,
            text="Optional. Sync is best-effort; entries are always saved locally first.",
            wraplength=320,
            justify="left",
        ).grid(row=2, column=0, columnspan=2, padx=5, pady=5, sticky="w")
        error_label = tk.Label(dialog, text="", fg="red")
        error_label.grid(row=3, column=0, columnspan=2, padx=5, sticky="w")

        def save_settings():
            server_url = url_entry.get().strip().rstrip("/")
            token = token_entry.get().strip()
            try:
                write_sync_config(server_url, token)
            except ValueError as e:
                error_label.config(text=str(e))
                return
            except OSError as e:
                error_label.config(text=f"Could not save sync settings: {e.strerror}")
                return
            self.sync_config = self.load_sync_config()
            dialog.destroy()

        tk.Button(dialog, text="Save", command=save_settings).grid(row=4, column=0, pady=10)
        tk.Button(dialog, text="Cancel", command=dialog.destroy).grid(row=4, column=1, pady=10)

    def sync_entry(self, event_id, is_timeline, category, body, occurred_at):
        """Best-effort POST of an already-saved entry to the web app; never raises."""
        if not self.sync_config:
            return
        if not event_id:
            self.root.after(0, lambda: self.sync_status.config(text="Sync skipped (no EventID)"))
            return

        payload = build_ingest_payload(event_id, is_timeline, category, body, occurred_at)

        def post_in_background():
            try:
                post_ingest(self.sync_config["server_url"], self.sync_config["token"], payload)
                status = f"Synced \u2713 {datetime.datetime.now().strftime('%H:%M:%S')}"
            except Exception:
                status = "Sync failed (saved locally)"
            self.root.after(0, lambda: self.sync_status.config(text=status))

        threading.Thread(target=post_in_background, daemon=True).start()

    def toggle_category(self):
        if self.log_type.get() == "Timestamp Event":
            self.category_label.grid_remove()
            self.category.grid_remove()
        else:
            self.category_label.grid()
            self.category.grid()

    def update_past_events(self):
        """Detects both event folders (`Incident_1001/`) and standalone Markdown files (`1001.md`)."""
        event_ids = set()

        for item in os.listdir():
            if re.match(r"Incident_\d+$", item) and os.path.isdir(item):  # Match folder
                event_ids.add(item.replace("Incident_", ""))
            if re.match(r"\d+\.md$", item):  # Match standalone Markdown
                event_ids.add(item.replace(".md", ""))

        self.past_events["values"] = sorted(event_ids, key=lambda x: int(x) if x.isdigit() else x)

    def load_selected_event(self, event=None):
        """Loads selected event and updates preview."""
        selected = self.past_events.get()
        if selected:
            self.event_id.delete(0, tk.END)
            self.event_id.insert(0, selected)
            self.refresh_preview()

    def refresh_preview(self):
        """Checks both folder-based and standalone files for event data."""
        event_id = self.event_id.get().strip()
        if not event_id:
            return
        
        folder_path = f"Incident_{event_id}"
        file_in_folder = os.path.join(folder_path, "Event_Report.md")
        standalone_file = f"{event_id}.md"

        self.preview.config(state="normal")
        self.preview.delete("1.0", tk.END)

        if os.path.exists(file_in_folder):
            with open(file_in_folder, "r") as f:
                self.preview.insert(tk.END, f.read())
        elif os.path.exists(standalone_file):
            with open(standalone_file, "r") as f:
                self.preview.insert(tk.END, f.read())

        self.preview.config(state="disabled")

    def log_entry(self, filename):
        """Logs the event details without overwriting existing entries."""
        is_timeline = self.log_type.get() == "Timestamp Event"
        category = self.category.get() if not is_timeline else "Timeline Event"
        data = self.data.get("1.0", tk.END).strip()
        username = getpass.getuser()  # Get the logged-in user's name

        if not data:
            messagebox.showerror("Error", "Details cannot be empty!")
            return

        now = datetime.datetime.now()
        timestamp = now.strftime("%Y-%m-%d %H:%M")
        entry = f"- [{timestamp}] {username}: {data}\n"

        with open(filename, "a") as f:  # Open in append mode
            f.write(f"\n## {category}\n{entry}")

        self.data.delete("1.0", tk.END)
        self.refresh_preview()
        self.update_past_events()

        # Strictly after the local write, and never allowed to affect it.
        self.sync_entry(
            event_id=self.event_id.get().strip(),
            is_timeline=is_timeline,
            category=category,
            body=data,
            occurred_at=normalize_utc(now.astimezone()),
        )

    def save_entry(self):
        """Saves the log entry under the current EventID."""
        event_folder = f"Incident_{self.event_id.get().strip()}"
        os.makedirs(event_folder, exist_ok=True)  # Ensure folder exists
        filename = os.path.join(event_folder, "Event_Report.md")
        self.log_entry(filename)

    def save_entry_as(self):
        """Saves the log entry as a new file."""
        file_path = filedialog.asksaveasfilename(defaultextension=".md", filetypes=[("Markdown files", "*.md")])
        if file_path:
            self.log_entry(file_path)
    def add_file(self):
        """Allows the user to attach a file to the log entry inside its event folder, without overwriting."""
        file_path = filedialog.askopenfilename()
        if file_path:
            event_folder = f"Incident_{self.event_id.get().strip()}"
            os.makedirs(event_folder, exist_ok=True)  # Ensure the event folder exists
            dest_path = os.path.join(event_folder, os.path.basename(file_path))
            shutil.copy(file_path, dest_path)

            filename = os.path.join(event_folder, "Event_Report.md")

            # Append the attached file entry under the correct section
            category = self.category.get()
            file_entry = f"- [Attached File: {dest_path}]\n"

            # Read the existing content
            if os.path.exists(filename):
                with open(filename, "r") as f:
                    content = f.readlines()
            else:
                content = []

            # Find the correct section and insert the file entry
            section_found = False
            for i, line in enumerate(content):
                if line.strip() == f"## {category}":
                    section_found = True
                    # Insert file entry after section header
                    content.insert(i + 1, file_entry)
                    break

            # If the section doesn't exist, add it at the end
            if not section_found:
                content.append(f"\n## {category}\n{file_entry}")

            # Write the updated content back to the file
            with open(filename, "w") as f:
                f.writelines(content)

            # Refresh preview to reflect changes
            self.refresh_preview()

    
    def paste_image(self):
        """Captures an image from the clipboard and saves it inside the event folder."""
        if not pillow_installed:
            messagebox.showerror("Error", "Image support requires Pillow. Install it with 'pip install Pillow'.")
            return
        try:
            img = ImageGrab.grabclipboard()
            if isinstance(img, Image.Image):
                event_folder = f"Incident_{self.event_id.get().strip()}"
                os.makedirs(event_folder, exist_ok=True)  # Ensure folder exists
                timestamp = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
                img_path = os.path.join(event_folder, f"screenshot_{timestamp}.png")
                img.save(img_path, "PNG")
                self.data.insert(tk.END, f"\n[Attached Image: {img_path}]")
            else:
                messagebox.showerror("Error", "No image found in clipboard!")
        except Exception as e:
            messagebox.showerror("Error", f"Failed to paste image: {e}")

if __name__ == "__main__":
    root = tk.Tk()
    app = IRLoggerApp(root)
    root.mainloop()
