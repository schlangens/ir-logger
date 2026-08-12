# Incident Response Logger

> **v1 (this desktop tool) is still fully supported and works standalone,
> exactly as documented below.** A hosted web application, Incident Logger
> v2, is also being built on top of it — a shared, multi-analyst version
> with live timelines, MITRE ATT&CK tagging, hashed evidence, and report
> export. See [`SPEC.md`](SPEC.md) for the full v2 specification. v1 will
> gain an optional, opt-in mode to sync its entries into v2, but never
> requires the server to work.

The "Incident Response Logger" is a graphical user interface (GUI) tool built with Python and `tkinter` to assist incident response (IR) analysts in logging and organizing findings during an incident investigation. It supports logging technical details, timeline events, file attachments, and image captures, with options for both event-specific folder outputs (`Incident_<EventID>/`) or standalone Markdown files.

## Features
- Log technical findings under categories like Initial Access, Persistence, and Exfiltration.
- Record timeline events for chronological tracking.
- Attach files and paste images from the clipboard (requires `Pillow`).
- Save logs to event-specific folders (`Incident_<EventID>/Event_Report.md`) or standalone Markdown files.
- Load and preview past event logs using a dropdown of existing `EventID`s.
- Option to save locally for non-collaborative work.

### Empty State
![Empty State](Screenshots-IR-Logger/20250220160032.png)
The initial state of the GUI, ready for input with the `EventID` field and past events dropdown.

### Technical Details Entry
![Technical Details Entry](Screenshots-IR-Logger/20250220160153.png)
An example of logging a technical finding under "Initial Access," including text and an attached image.

### Timeline Event Entry
![Timeline Event Entry](Screenshots-IR-Logger/20250220160240.png)
An example of logging a timeline event, such as "Incident escalated."

### Preview with Entries
![Preview with Entries](Screenshots-IR-Logger/20250220160332.png)
The "Current Report" showing logged entries for `EventID 1001` after refreshing.

### File Attachment
![File Attachment](Screenshots-IR-Logger/20250220160453.png)
An example of attaching a file, visible in the "Details" and saved to the event folder.


---

## Instructions to Install Dependencies:
Ensure you have Python installed on your system.

Open a terminal or command prompt.

Navigate to the directory where your requirements.txt file is located.

Run the following command:

``pip install -r requirements.txt``

This will install the required dependencies for your script. Note that tkinter is included with Python by default, so it may not need installation separately. However, pillow must be installed for image handling features to work.
    

## Usage Instructions

### 1. Starting the Tool

Upon launching, the GUI displays:

- An `EventID` entry field for unique identification (e.g., `1001`).
    
- A "Past Event IDs" dropdown to load existing event logs.
    
- Options for "Technical Details" or "Timeline Event" logging.
    
- A category dropdown (for "Technical Details"), "Details" text box, and buttons for file/image attachments.
    

### 2. Logging an Entry

#### Technical Details

1. Enter `EventID` (e.g., `1001`) or select from "Past Event IDs" to load existing data.
    
2. Select **Log Type**: "Technical Details."
    
3. Choose **Category** (e.g., "Initial Access").
    
4. Add **Details** (e.g., "Phishing email detected").
    
5. Attach files/images:
    
    - **Add File**: Uploads a file (saved to `Incident_<EventID>/` and linked in the log).
        
    - **Paste Image**: Pastes an image from the clipboard (requires `Pillow`).
        
6. **Save**:
    
    - Click "Save" to log the entry to `Incident_<EventID>/Event_Report.md`.
        
    - Or click "Save As" to choose a custom Markdown file location.
        

#### Timeline Event

1. Enter `EventID`.
    
2. Select **Log Type**: "Timeline Event."
    
3. Add **Details** (e.g., "Incident escalated to management").
    
4. Click **Save** or **Save As** to log under the "Timeline Event" section.
    

### 3. Previewing Logs

- Click **Refresh Preview** to view the current contents of `Incident_<EventID>/Event_Report.md` or the standalone `.md` file.
    
- The preview shows raw Markdown text (not rendered images or formatting). Use an external Markdown viewer (e.g., VS Code, GitHub) for full visualization.
    

### 4. Loading Past Events

- Use the "Past Event IDs" dropdown to select an existing `EventID` (e.g., `1001`).
    
- The GUI loads the corresponding `Incident_<EventID>/Event_Report.md` or `<EventID>.md` for review or continued logging.
    

### 5. Non-Collaborative Work

- Use **Save As** to save logs to a custom location.
    
- Use **Save** for event-specific folders to avoid shared file conflicts.
    

### 6. Optional: Syncing to the web app

Sync is entirely optional and off by default — with no sync settings saved, the tool behaves exactly as described above and never contacts a server.

1. Click **Sync Settings** (next to "Save" / "Save As") and enter:
    
    - **Server base URL**: the Incident Logger v2 instance you want entries to land in (e.g. `https://ir.example.com`).
        
    - **API token**: create one on the web app's **workspace settings** page, in its API tokens section, and paste it here.
        
2. Click **Save** in the dialog. The values are written to `ir-logger-sync.json` next to `ir-logger.py` (git-ignored) so they persist between runs. The token is only ever stored in that local file.
    
3. From then on, each **Save** / **Save As** writes the local Markdown entry first, exactly as before, and then attempts to send the same entry to the server. The `EventID` is used as the incident reference, and the incident is created on the server if it doesn't exist yet.
    
4. A status label under the buttons shows the result: `Synced ✓ <HH:MM:SS>` on success, or `Sync failed (saved locally)` if the server is unreachable, the token is rejected, or the request times out (5 seconds).
    

The server URL must use `https`; `http` is allowed only for `localhost`, `127.0.0.1`, or `[::1]` development servers. The token file is created with `0600` permissions (on Windows, POSIX mode bits do not apply the same way and `chmod` only toggles the read-only bit, so restrict it with NTFS ACLs/file properties). Redirects are rejected as sync failures. A blank `EventID` skips sync, and timestamps are sent as UTC. Python's `urllib` honors `http_proxy`/`https_proxy` from the environment, so incident text and the bearer token traverse whatever proxy the responder's host has configured.

Sync is best-effort and always secondary to the local file: a sync failure never blocks a save, never pops up an error dialog, and never loses an entry — the local Markdown file remains the authoritative record. Attachments added with **Add File** and **Paste Image** stay local-only and are not synced.

---

## File Structure

- **Event Folders**: Logs are stored in `Incident_<EventID>/Event_Report.md` by default, with attached files/images in the same folder (e.g., `Incident_1001/screenshot_20250220_...png`).
    
- **Standalone Files**: Optionally, save as `<EventID>.md` using "Save As."
    
- **Samples**: Attached files and images are linked in Markdown as `[Attached File: ...]` or `[Attached Image: ...]`.
    

---

## Troubleshooting

- **Images Not Working**: Ensure `Pillow` is installed (`pip install Pillow`). Verify an image is in the clipboard before pasting.
    
- **Empty Preview**: Ensure the `EventID` matches an existing `Incident_<EventID>/` folder or `.md` file. Click "Refresh Preview" to update.
    
- **Permissions**: Verify write permissions for your working directory (e.g., `C:\Users\YourDirectory\`).
    

---

## Contributing

- Fork this repository, modify `ir-logger.py`, and submit pull requests on GitHub.
    
- Report issues or suggest features by opening an issue on the GitHub repository.
    

---

## License

This project is licensed under the MIT License - see [LICENSE](LICENSE).