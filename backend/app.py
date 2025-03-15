from flask import Flask, request, Response, jsonify
from flask_cors import CORS
import os
import time
import json
import re
import threading
import logging
import yt_dlp

app = Flask(__name__)
CORS(app)

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

DOWNLOAD_DIR = os.path.join(os.path.expanduser("~"), "Downloads", "YouTube-Downloader")
os.makedirs(DOWNLOAD_DIR, exist_ok=True)

download_progress = {}
active_downloads = set()

def send_progress_update(download_id, status, percentage=0, download_path=None, message=None):
    update = {
        "status": status,
        "percentage": percentage
    }

    if download_path:
        update["download_path"] = download_path

    if message:
        update["message"] = message

    download_progress[download_id] = update

    if status in ["complete", "error"]:
        def remove_download_id():
            if download_id in download_progress:
                del download_progress[download_id]
            if download_id in active_downloads:
                active_downloads.remove(download_id)

        threading.Timer(10.0, remove_download_id).start()

def clean_filename(filename):
    filename = re.sub(r'[\\/*?:"<>|]', "", filename)
    return filename[:100]

def format_duration(seconds):
    minutes = int(seconds // 60)
    seconds = int(seconds % 60)
    return f"{minutes}:{seconds:02d}"

def my_hook(d, download_id):
    if d['status'] == 'downloading':
        percentage = 0
        if 'total_bytes' in d and d['total_bytes'] > 0:
            percentage = int(d['downloaded_bytes'] / d['total_bytes'] * 100)
        elif 'total_bytes_estimate' in d and d['total_bytes_estimate'] > 0:
            percentage = int(d['downloaded_bytes'] / d['total_bytes_estimate'] * 100)

        send_progress_update(download_id, "progress", percentage)

    elif d['status'] == 'finished':
        send_progress_update(download_id, "progress", 100, message="Download finished, processing file...")

@app.route('/video_info', methods=['GET'])
def get_video_info():
    video_id = request.args.get('video_id')

    if not video_id:
        return jsonify({"error": "Missing video_id parameter"}), 400

    try:
        url = f"https://www.youtube.com/watch?v={video_id}"

        ydl_opts = {
            'quiet': True,
            'no_warnings': True,
            'skip_download': True,
        }

        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(url, download=False)

        video_info = {
            "title": info.get('title', 'Unknown Title'),
            "channel": info.get('uploader', 'Unknown Channel'),
            "thumbnail_url": info.get('thumbnail', f"https://i.ytimg.com/vi/{video_id}/hqdefault.jpg"),
            "duration": info.get('duration', 0),
            "views": info.get('view_count', 0),
            "video_id": video_id,
            "is_downloading": video_id in active_downloads
        }

        return jsonify(video_info)

    except Exception as e:
        logger.error(f"Error fetching video info: {str(e)}")

        try:
            import requests

            logger.info("Attempting fallback method to fetch video info")

            thumbnail_url = f"https://i.ytimg.com/vi/{video_id}/hqdefault.jpg"

            video_info = {
                "title": f"YouTube Video ({video_id})",
                "channel": "Unknown Channel",
                "thumbnail_url": thumbnail_url,
                "duration": 0,
                "views": 0,
                "video_id": video_id,
                "is_downloading": video_id in active_downloads
            }

            return jsonify(video_info)

        except Exception as fallback_error:
            logger.error(f"Fallback method also failed: {str(fallback_error)}")
            return jsonify({"error": str(e)}), 500

def download_video_task(video_id, format_type, quality, download_id):
    url = f"https://www.youtube.com/watch?v={video_id}"

    try:
        ydl_opts_info = {
            'quiet': True,
            'no_warnings': True,
            'skip_download': True,
        }

        with yt_dlp.YoutubeDL(ydl_opts_info) as ydl:
            info = ydl.extract_info(url, download=False)

        video_title = clean_filename(info.get('title', f'video_{video_id}'))

        if format_type == "mp4":
            output_template = os.path.join(DOWNLOAD_DIR, f"{video_title}.mp4")

            format_selection = 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/mp4'
            if quality != "highest":
                resolution = quality.replace('p', '')
                format_selection = f'bestvideo[height<={resolution}][ext=mp4]+bestaudio[ext=m4a]/best[height<={resolution}][ext=mp4]/mp4'

            ydl_opts = {
                'format': format_selection,
                'outtmpl': output_template,
                'progress_hooks': [lambda d: my_hook(d, download_id)]
            }

            with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                ydl.download([url])

            send_progress_update(
                download_id,
                "complete",
                100,
                os.path.basename(output_template)
            )

        elif format_type == "mp3":
            output_template = os.path.join(DOWNLOAD_DIR, f"{video_title}.mp3")

            ydl_opts = {
                'format': 'bestaudio/best',
                'postprocessors': [{
                    'key': 'FFmpegExtractAudio',
                    'preferredcodec': 'mp3',
                    'preferredquality': '192',
                }],
                'outtmpl': os.path.join(DOWNLOAD_DIR, f"{video_title}"),
                'progress_hooks': [lambda d: my_hook(d, download_id)]
            }

            with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                ydl.download([url])

            send_progress_update(
                download_id,
                "complete",
                100,
                f"{video_title}.mp3"
            )

    except Exception as e:
        logger.error(f"Download error: {str(e)}")
        send_progress_update(download_id, "error", 0, message=str(e))

@app.route('/download', methods=['GET'])
def download_video():
    video_id = request.args.get('video_id')
    format_type = request.args.get('format', 'mp4')
    quality = request.args.get('quality', 'highest')

    if not video_id:
        return jsonify({"error": "Missing video_id parameter"}), 400

    if video_id in active_downloads:
        return jsonify({
            "error": "This video is already being downloaded",
            "status": "error",
            "message": "This video is already being downloaded"
        }), 409  # 409 Conflict. supir cool

    download_id = video_id
    active_downloads.add(download_id)

    send_progress_update(download_id, "progress", 0)

    threading.Thread(
        target=download_video_task,
        args=(video_id, format_type, quality, download_id)
    ).start()

    def generate():
        last_progress = None

        while True:
            current_progress = download_progress.get(download_id)

            if current_progress and current_progress != last_progress:
                last_progress = current_progress.copy()
                yield f"id: {download_id}\ndata: {json.dumps(current_progress)}\n\n"

                if current_progress["status"] in ["complete", "error"]:
                    break

            time.sleep(0.5)

    return Response(generate(), mimetype='text/event-stream')

@app.route('/download_status', methods=['GET'])
def get_download_status():
    download_id = request.args.get('download_id')

    if not download_id:
        return jsonify({"error": "Missing download_id parameter"}), 400

    progress_data = download_progress.get(download_id, {})

    if not progress_data:
        return jsonify({
            "status": "unknown",
            "message": "No download found with that ID",
            "percentage": 0
        })

    if "status" not in progress_data:
        progress_data["status"] = "progress"

    return jsonify(progress_data)

@app.route('/cancel_download', methods=['POST'])
def cancel_download():
    download_id = request.json.get('download_id')

    if not download_id:
        return jsonify({"error": "Missing download_id parameter"}), 400

    if download_id in active_downloads:
        active_downloads.remove(download_id)

    if download_id in download_progress:
        del download_progress[download_id]

    return jsonify({"status": "cancelled"})

if __name__ == '__main__':
    app.run(debug=True, host='localhost', port=5000)