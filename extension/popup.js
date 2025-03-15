
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

    // Function to format duration from seconds
    function formatDuration(seconds) {
        const minutes = Math.floor(seconds / 60);
        const remainingSeconds = seconds % 60;
        return `${minutes}:${remainingSeconds < 10 ? '0' : ''}${remainingSeconds}`;
    }

    // Check for format change
    document.querySelectorAll('input[name="format"]').forEach(input => {
        input.addEventListener('change', function() {
            if (this.value === 'mp3') {
                videoQualitySection.style.display = 'none';
            } else {
                videoQualitySection.style.display = 'block';
            }
        });
    });

    // Get current tab information when popup opens
    chrome.tabs.query({active: true, currentWindow: true}, function(tabs) {
        const currentTab = tabs[0];
        const url = currentTab.url;

        // Check if this is a YouTube video page
        const youtubeVideoRegex = /(?:youtube\.com\/(?:watch\?v=|embed\/|v\/)|youtu\.be\/)([a-zA-Z0-9_-]+)/;
        const match = url.match(youtubeVideoRegex);

        if (match) {
            currentVideoId = match[1];
            fetchVideoInfo(currentVideoId);
        } else {
            showError("This is not a YouTube video page.");
        }
    });

    // Fetch video information
    function fetchVideoInfo(videoId) {
        // In a real extension, you might use YouTube's API here
        // For now, we'll use our backend server
        fetch(`http://localhost:5000/video_info?video_id=${videoId}`)
            .then(response => response.json())
            .then(data => {
                videoData = data;

                // Update UI with video information
                videoThumbnail.src = data.thumbnail_url;
                videoTitle.textContent = data.title;
                videoChannel.textContent = data.channel;
                videoDuration.textContent = formatDuration(data.duration);

                // Enable download button
                downloadBtn.disabled = false;
            })
            .catch(error => {
                showError("Could not fetch video information. Make sure the backend server is running.");
                console.error(error);
            });
    }

    // Download button click handler
    downloadBtn.addEventListener('click', function() {
        if (!currentVideoId) {
            showError("No video detected.");
            return;
        }

        const format = document.querySelector('input[name="format"]:checked').value;
        const quality = document.getElementById('video-quality').value;

        // Show progress UI
        progressContainer.style.display = 'block';
        statusMessage.textContent = 'Starting download...';
        statusMessage.className = 'status';
        downloadBtn.disabled = true;

        // Start download request
        startDownload(currentVideoId, format, quality);
    });

    // Function to start download
    function startDownload(videoId, format, quality) {
        const downloadUrl = `http://localhost:5000/download?video_id=${videoId}&format=${format}&quality=${quality}`;

        // Set up EventSource for progress updates
        const eventSource = new EventSource(downloadUrl);

        eventSource.onmessage = function(event) {
            const data = JSON.parse(event.data);

            if (data.status === 'progress') {
                updateProgress(data.percentage);
            } else if (data.status === 'complete') {
                downloadComplete(data.download_path);
                eventSource.close();
            } else if (data.status === 'error') {
                showError(data.message);
                eventSource.close();
            }
        };

        eventSource.onerror = function() {
            showError("Connection to server lost");
            eventSource.close();
            downloadBtn.disabled = false;
        };
    }

    // Update progress bar
    function updateProgress(percentage) {
        progressBarFill.style.width = `${percentage}%`;
        progressText.textContent = `${percentage}%`;
    }

    // Download complete
    function downloadComplete(downloadPath) {
        updateProgress(100);
        statusMessage.textContent = `Download complete: ${downloadPath}`;
        statusMessage.className = 'status success';
        downloadBtn.disabled = false;
    }

    // Show error message
    function showError(message) {
        statusMessage.textContent = message;
        statusMessage.className = 'status error';
    }
});