import os
import sys

if sys.platform == "win32":
    try:
        if hasattr(sys.stdout, 'reconfigure'):
            sys.stdout.reconfigure(encoding='utf-8', errors='replace')
        if hasattr(sys.stderr, 'reconfigure'):
            sys.stderr.reconfigure(encoding='utf-8', errors='replace')
    except Exception:
        pass

import socket
import psutil
import io
import uuid
import json
import zipfile
import mimetypes
from datetime import datetime
from typing import List, Optional
import qrcode
from qrcode.image.styledpil import StyledPilImage
from qrcode.image.styles.moduledrawers import RoundedModuleDrawer
from qrcode.image.styles.colormasks import SolidFillColorMask

import uvicorn
from fastapi import FastAPI, Request, UploadFile, File, Form, WebSocket, WebSocketDisconnect, HTTPException
from fastapi.responses import HTMLResponse, StreamingResponse, FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from fastapi.middleware.cors import CORSMiddleware

# Initialize directories
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
UPLOADS_DIR = os.path.join(BASE_DIR, "uploads")
STATIC_DIR = os.path.join(BASE_DIR, "static")
TEMPLATES_DIR = os.path.join(BASE_DIR, "templates")
DATA_FILE = os.path.join(BASE_DIR, "files_db.json")

os.makedirs(UPLOADS_DIR, exist_ok=True)
os.makedirs(STATIC_DIR, exist_ok=True)
os.makedirs(TEMPLATES_DIR, exist_ok=True)

app = FastAPI(title="QR File Transfer Pro", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")
templates = Jinja2Templates(directory=TEMPLATES_DIR)

# WebSocket connection manager
class ConnectionManager:
    def __init__(self):
        self.active_connections: List[WebSocket] = []

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active_connections.append(websocket)

    def disconnect(self, websocket: WebSocket):
        if websocket in self.active_connections:
            self.active_connections.remove(websocket)

    async def broadcast(self, message: dict):
        for connection in list(self.active_connections):
            try:
                await connection.send_json(message)
            except Exception:
                self.disconnect(connection)

manager = ConnectionManager()

# In-Memory & Persistent Storage
def load_db():
    if os.path.exists(DATA_FILE):
        try:
            with open(DATA_FILE, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            return {"shares": {}, "files": {}}
    return {"shares": {}, "files": {}}

def save_db(db):
    try:
        with open(DATA_FILE, "w", encoding="utf-8") as f:
            json.dump(db, f, ensure_ascii=False, indent=2)
    except Exception as e:
        print(f"Error saving db: {e}")

DB = load_db()

def format_file_size(size_bytes: int) -> str:
    if size_bytes == 0:
        return "0 B"
    units = ["B", "KB", "MB", "GB", "TB"]
    i = 0
    size = float(size_bytes)
    while size >= 1024.0 and i < len(units) - 1:
        size /= 1024.0
        i += 1
    return f"{size:.2f} {units[i]}"

def get_network_interfaces():
    """Detect all IPv4 network interfaces and choose the best primary LAN IP."""
    interfaces = []
    primary_ip = "127.0.0.1"

    # Try connecting to external DNS to find the active default gateway adapter
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(('8.8.8.8', 80))
        primary_ip = s.getsockname()[0]
        s.close()
    except Exception:
        pass

    # Enumerate all interfaces via psutil
    try:
        for iface_name, snics in psutil.net_if_addrs().items():
            for snic in snics:
                if snic.family == socket.AF_INET:
                    ip = snic.address
                    if not ip.startswith("127.") and not ip.startswith("169.254."):
                        is_primary = (ip == primary_ip)
                        interfaces.append({
                            "name": iface_name,
                            "ip": ip,
                            "is_primary": is_primary
                        })
    except Exception as e:
        print(f"Error fetching interfaces: {e}")

    # Fallback if no non-loopback IPs found
    if not interfaces:
        interfaces.append({
            "name": "Localhost",
            "ip": "127.0.0.1",
            "is_primary": True
        })
        primary_ip = "127.0.0.1"
    else:
        # Sort so primary is first
        interfaces.sort(key=lambda x: 0 if x["is_primary"] else 1)

    return primary_ip, interfaces

# QR Code Generation Helper
def generate_qr_bytes(text: str) -> bytes:
    qr = qrcode.QRCode(
        version=None,
        error_correction=qrcode.constants.ERROR_CORRECT_M,
        box_size=10,
        border=2,
    )
    qr.add_data(text)
    qr.make(fit=True)
    img = qr.make_image(
        image_factory=StyledPilImage,
        module_drawer=RoundedModuleDrawer(),
        color_mask=SolidFillColorMask(back_color=(255, 255, 255), front_color=(15, 23, 42))
    )
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()

# Favicon endpoint to prevent 404 logs in console
@app.get("/favicon.ico", include_in_schema=False)
async def favicon():
    # Return a clean SVG QR icon as favicon
    svg_icon = """<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#38bdf8" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <rect x="3" y="3" width="7" height="7"></rect>
        <rect x="14" y="3" width="7" height="7"></rect>
        <rect x="14" y="14" width="7" height="7"></rect>
        <rect x="3" y="14" width="7" height="7"></rect>
    </svg>"""
    return HTMLResponse(content=svg_icon, media_type="image/svg+xml")

# WebSocket Endpoint
@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await manager.connect(websocket)
    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        manager.disconnect(websocket)
    except Exception:
        manager.disconnect(websocket)

# API: Get network info & current state
@app.get("/api/info")
async def get_info(request: Request):
    primary_ip, interfaces = get_network_interfaces()
    port = request.url.port or 5000
    return {
        "primary_ip": primary_ip,
        "interfaces": interfaces,
        "port": port,
        "uploads_dir": UPLOADS_DIR,
        "files_count": len(DB["files"]),
        "shares_count": len(DB["shares"])
    }

# API: Generate QR Code image directly
@app.get("/api/qr")
async def get_qr(text: str):
    if not text:
        raise HTTPException(status_code=400, detail="Missing text parameter")
    png_bytes = generate_qr_bytes(text)
    return StreamingResponse(io.BytesIO(png_bytes), media_type="image/png")

# API: Open downloads/uploads folder in Windows File Explorer
@app.post("/api/open-folder")
async def open_folder():
    if sys.platform == "win32":
        try:
            os.startfile(UPLOADS_DIR)
            return {"status": "success", "message": "Folder opened"}
        except Exception as e:
            raise HTTPException(status_code=500, detail=str(e))
    return {"status": "unsupported", "message": "Only supported on Windows"}

# API: Upload Files (From PC Dashboard or Mobile)
@app.post("/api/upload")
async def upload_files(
    files: List[UploadFile] = File(...),
    direction: str = Form("pc_to_phone"), # 'pc_to_phone' or 'phone_to_pc'
    note: Optional[str] = Form("")
):
    if not files:
        raise HTTPException(status_code=400, detail="No files provided")

    share_id = str(uuid.uuid4())[:8]
    uploaded_files_info = []

    for file in files:
        file_id = str(uuid.uuid4())[:12]
        original_name = file.filename or "file.bin"
        safe_name = f"{file_id}_{original_name}"
        save_path = os.path.join(UPLOADS_DIR, safe_name)

        # Write file in chunks
        size = 0
        with open(save_path, "wb") as f_out:
            while chunk := await file.read(1024 * 1024):  # 1MB chunks
                f_out.write(chunk)
                size += len(chunk)

        mime_type, _ = mimetypes.guess_type(original_name)
        if not mime_type:
            mime_type = "application/octet-stream"

        file_info = {
            "id": file_id,
            "share_id": share_id,
            "name": original_name,
            "safe_name": safe_name,
            "path": save_path,
            "size": size,
            "size_formatted": format_file_size(size),
            "mime_type": mime_type,
            "direction": direction,
            "downloads": 0,
            "created_at": datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        }

        DB["files"][file_id] = file_info
        uploaded_files_info.append(file_info)

    # Register Share
    total_size = sum(f["size"] for f in uploaded_files_info)
    DB["shares"][share_id] = {
        "id": share_id,
        "files": [f["id"] for f in uploaded_files_info],
        "total_size": total_size,
        "total_size_formatted": format_file_size(total_size),
        "direction": direction,
        "note": note or "",
        "created_at": datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    }
    save_db(DB)

    # Broadcast to WebSocket clients
    await manager.broadcast({
        "event": "files_uploaded",
        "direction": direction,
        "share_id": share_id,
        "files": uploaded_files_info
    })

    return {
        "status": "success",
        "share_id": share_id,
        "files": uploaded_files_info
    }

# API: List all shared files
@app.get("/api/files")
async def list_files():
    # Return shares with their files ordered by creation (newest first)
    shares_list = []
    for s_id, s in reversed(list(DB["shares"].items())):
        files_details = [DB["files"][fid] for fid in s["files"] if fid in DB["files"]]
        shares_list.append({
            **s,
            "files_details": files_details
        })
    return {"shares": shares_list}

# API: Delete a file or a share
@app.delete("/api/shares/{share_id}")
async def delete_share(share_id: str):
    if share_id in DB["shares"]:
        share = DB["shares"].pop(share_id)
        for fid in share["files"]:
            if fid in DB["files"]:
                f_info = DB["files"].pop(fid)
                try:
                    if os.path.exists(f_info["path"]):
                        os.remove(f_info["path"])
                except Exception as e:
                    print(f"Error removing file {f_info['path']}: {e}")
        save_db(DB)
        await manager.broadcast({"event": "share_deleted", "share_id": share_id})
        return {"status": "success"}
    raise HTTPException(status_code=404, detail="Share not found")

# API: Clear all transfers
@app.delete("/api/clear-all")
async def clear_all():
    for f_info in DB["files"].values():
        try:
            if os.path.exists(f_info["path"]):
                os.remove(f_info["path"])
        except Exception:
            pass
    DB["shares"] = {}
    DB["files"] = {}
    save_db(DB)
    await manager.broadcast({"event": "all_cleared"})
    return {"status": "success"}

# Single File Download
@app.get("/download/{file_id}")
async def download_file(file_id: str):
    if file_id not in DB["files"]:
        raise HTTPException(status_code=404, detail="File not found")
    f_info = DB["files"][file_id]
    if not os.path.exists(f_info["path"]):
        raise HTTPException(status_code=404, detail="File missing from disk")

    # Increment download counter
    f_info["downloads"] += 1
    save_db(DB)
    await manager.broadcast({"event": "file_downloaded", "file_id": file_id, "downloads": f_info["downloads"]})

    return FileResponse(
        path=f_info["path"],
        filename=f_info["name"],
        media_type=f_info["mime_type"],
        content_disposition_type="attachment"
    )

# File Preview (Inline)
@app.get("/preview/{file_id}")
async def preview_file(file_id: str):
    if file_id not in DB["files"]:
        raise HTTPException(status_code=404, detail="File not found")
    f_info = DB["files"][file_id]
    if not os.path.exists(f_info["path"]):
        raise HTTPException(status_code=404, detail="File missing from disk")

    return FileResponse(
        path=f_info["path"],
        media_type=f_info["mime_type"],
        content_disposition_type="inline"
    )

# Download All Files in Share as ZIP
@app.get("/download-zip/{share_id}")
async def download_zip(share_id: str):
    if share_id not in DB["shares"]:
        raise HTTPException(status_code=404, detail="Share not found")
    share = DB["shares"][share_id]
    
    zip_buffer = io.BytesIO()
    with zipfile.ZipFile(zip_buffer, "w", zipfile.ZIP_DEFLATED) as zip_file:
        for fid in share["files"]:
            if fid in DB["files"]:
                f_info = DB["files"][fid]
                if os.path.exists(f_info["path"]):
                    zip_file.write(f_info["path"], arcname=f_info["name"])

    zip_buffer.seek(0)
    zip_filename = f"qr_transfer_{share_id}.zip"

    return StreamingResponse(
        zip_buffer,
        media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="{zip_filename}"'}
    )

# Page: Desktop Main Dashboard
@app.get("/", response_class=HTMLResponse)
async def index_page(request: Request):
    primary_ip, interfaces = get_network_interfaces()
    port = request.url.port or 5000
    return templates.TemplateResponse(
        request=request,
        name="index.html",
        context={
            "primary_ip": primary_ip,
            "interfaces": interfaces,
            "port": port
        }
    )

# Page: Mobile Download Page for a Share
@app.get("/d/{share_id}", response_class=HTMLResponse)
async def download_page(request: Request, share_id: str):
    if share_id not in DB["shares"]:
        return templates.TemplateResponse(
            request=request,
            name="not_found.html",
            context={"share_id": share_id}
        )
    
    share = DB["shares"][share_id]
    files_details = [DB["files"][fid] for fid in share["files"] if fid in DB["files"]]

    return templates.TemplateResponse(
        request=request,
        name="download.html",
        context={
            "share": share,
            "files": files_details
        }
    )

# Page: Mobile Upload Portal (Send to PC)
@app.get("/upload-portal", response_class=HTMLResponse)
async def upload_portal_page(request: Request):
    return templates.TemplateResponse(
        request=request,
        name="upload.html",
        context={}
    )

def find_available_port(start_port=5005, max_attempts=20):
    env_port = os.getenv("PORT")
    if env_port:
        try:
            return int(env_port)
        except ValueError:
            pass
    for p in range(start_port, start_port + max_attempts):
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            if s.connect_ex(('127.0.0.1', p)) != 0:
                return p
    return start_port

if __name__ == "__main__":
    import threading
    import webbrowser
    import time

    primary_ip, _ = get_network_interfaces()
    port = find_available_port(5005)
    print("=" * 60)
    print("  [QR DROP PRO] File Transfer via QR Code")
    print(f"  PC Dashboard : http://localhost:{port}")
    print(f"  Mobile LAN   : http://{primary_ip}:{port}")
    print("=" * 60)

    def open_browser():
        time.sleep(1.2)
        try:
            webbrowser.open(f"http://localhost:{port}")
        except Exception:
            pass

    threading.Thread(target=open_browser, daemon=True).start()
    uvicorn.run("app:app", host="0.0.0.0", port=port, reload=False)
