document.addEventListener('DOMContentLoaded', function() {
    const videoThumbnail = document.getElementById('video-thumbnail');
    const videoTitle = document.getElementById('video-title');
    const videoChannel = document.getElementById('video-channel');
    const videoDuration = document.getElementById('video-duration');
    const downloadBtn = document.getElementById('download-btn');
    const progressContainer = document.getElementById('progress-container');
    const progressBarFill = document.getElementById('progress-bar-fill');
    const progressText = document.getElementById('progress-text');
    const statusMessage = document.getElementById('status-message');
    const videoQualitySection = document.getElementById('video-quality-section');

    let currentVideoId = null;
    let videoData = null;
    let activeDownloadId = null;

    function formatDuration(seconds) {
        const minutes = Math.floor(seconds / 60);
        const remainingSeconds = seconds % 60;
        return `${minutes}:${remainingSeconds < 10 ? '0' : ''}${remainingSeconds}`;
    }

    document.querySelectorAll('input[name="format"]').forEach(input => {
        input.addEventListener('change', function() {
            if (this.value === 'mp3') {
                videoQualitySection.style.display = 'none';
            } else {
                videoQualitySection.style.display = 'block';
            }
        });
    });

    function checkForOngoingDownloads() {
        chrome.storage.local.get(['activeDownload'], function(result) {
            if (result.activeDownload) {
                activeDownloadId = result.activeDownload.downloadId;
                currentVideoId = result.activeDownload.videoId;

                if (result.activeDownload.videoData) {
                    videoData = result.activeDownload.videoData;
                    restoreVideoInfo(videoData);
                }

                progressContainer.style.display = 'block';
                downloadBtn.disabled = true;

                pollDownloadProgress(activeDownloadId);
            } else {
                detectCurrentVideo();
            }
        });
    }

    function restoreVideoInfo(data) {
        videoThumbnail.src = data.thumbnail_url;
        videoTitle.textContent = data.title;
        videoChannel.textContent = data.channel;
        if (data.duration) {
            videoDuration.textContent = formatDuration(data.duration);
        }

        if (data.is_downloading) {
            downloadBtn.disabled = true;
            statusMessage.textContent = "This video is already being downloaded";
            statusMessage.className = 'status warning';
        }
    }

    function pollDownloadProgress(downloadId) {
        fetch(`http://localhost:5000/download_status?download_id=${downloadId}`)
            .then(response => response.json())
            .then(data => {
                if (data.status) {
                    updateProgress(data.percentage || 0);

                    if (data.message) {
                        statusMessage.textContent = data.message;
                    }

                    if (data.status === 'complete') {
                        downloadComplete(data.download_path);
                        clearActiveDownload();
                    } else if (data.status === 'error') {
                        showError(data.message || 'Download failed');
                        clearActiveDownload();
                    } else if (data.status === 'unknown') {
                        showError('Download not found. It may have completed or been cancelled.');
                        clearActiveDownload();
                    } else {
                        setTimeout(() => pollDownloadProgress(downloadId), 1000);
                    }
                } else {
                    showError('Download status unknown. The server might have restarted.');
                    clearActiveDownload();
                }
            })
            .catch(error => {
                showError('Error checking download status. Is the server running?');
                console.error(error);
                setTimeout(() => pollDownloadProgress(downloadId), 5000);
            });
    }

    function clearActiveDownload() {
        chrome.storage.local.remove(['activeDownload']);
        activeDownloadId = null;
        downloadBtn.disabled = false;
    }

    function detectCurrentVideo() {
        chrome.tabs.query({active: true, currentWindow: true}, function(tabs) {
            const currentTab = tabs[0];
            const url = currentTab.url;

            const youtubeVideoRegex = /(?:youtube\.com\/(?:watch\?v=|embed\/|v\/)|youtu\.be\/)([a-zA-Z0-9_-]+)/;
            const match = url.match(youtubeVideoRegex);

            if (match) {
                currentVideoId = match[1];
                fetchVideoInfo(currentVideoId);
            } else {
                showError("This is not a YouTube video page.");
            }
        });
    }

    function fetchVideoInfo(videoId) {
        fetch(`http://localhost:5000/video_info?video_id=${videoId}`)
            .then(response => response.json())
            .then(data => {
                videoData = data;
                restoreVideoInfo(data);

                if (!data.is_downloading) {
                    downloadBtn.disabled = false;
                }
            })
            .catch(error => {
                showError("Could not fetch video information. Make sure the backend server is running.");
                console.error(error);
            });
    }

    downloadBtn.addEventListener('click', function() {
        if (!currentVideoId) {
            showError("No video detected.");
            return;
        }

        const format = document.querySelector('input[name="format"]:checked').value;
        const quality = document.getElementById('video-quality').value;

        progressContainer.style.display = 'block';
        statusMessage.textContent = 'Starting download...';
        statusMessage.className = 'status';
        downloadBtn.disabled = true;

        startDownload(currentVideoId, format, quality);
    });

    function startDownload(videoId, format, quality) {
        const downloadUrl = `http://localhost:5000/download?video_id=${videoId}&format=${format}&quality=${quality}`;

        const eventSource = new EventSource(downloadUrl);

        eventSource.onmessage = function(event) {
            const data = JSON.parse(event.data);

            if (!activeDownloadId && data.status) {
                activeDownloadId = videoId;

                chrome.storage.local.set({
                    activeDownload: {
                        downloadId: activeDownloadId,
                        videoId: videoId,
                        videoData: videoData,
                        format: format,
                        quality: quality
                    }
                });
            }

            if (data.status === 'progress') {
                updateProgress(data.percentage);
            } else if (data.status === 'complete') {
                downloadComplete(data.download_path);
                clearActiveDownload();
                eventSource.close();
            } else if (data.status === 'error') {
                showError(data.message);
                clearActiveDownload();
                eventSource.close();
            }
        };

        eventSource.onerror = function() {
            showError("Connection to server lost");
            eventSource.close();
            downloadBtn.disabled = false;
        };
    }

    function updateProgress(percentage) {
        progressBarFill.style.width = `${percentage}%`;
        progressText.textContent = `${percentage}%`;
    }

    function downloadComplete(downloadPath) {
        updateProgress(100);
        statusMessage.textContent = `Download complete: ${downloadPath}`;
        statusMessage.className = 'status success';
        downloadBtn.disabled = false;
    }

    function showError(message) {
        statusMessage.textContent = message;
        statusMessage.className = 'status error';
    }

    checkForOngoingDownloads();
});