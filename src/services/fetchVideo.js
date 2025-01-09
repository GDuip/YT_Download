const API_BASE_URL = "https://yt-downloader-backend-x7xx.onrender.com"; // Consider using an environment variable

// --- Custom Error Classes ---
class NetworkError extends Error {
  constructor(message) {
    super(message);
    this.name = "NetworkError";
  }
}

class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

class ValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = "ValidationError";
  }
}

// --- Helper function for making API requests with retries and cancellation ---
const makeApiRequest = async (
  endpoint,
  url,
  retries = 3,
  retryDelay = 1000,
  signal = null
) => {
  const validateYoutubeUrl = (url) => {
    // Basic YouTube URL validation (you can use a more robust regex if needed)
    const youtubeRegex =
      /^(https?:\/\/)?(www\.)?(youtube\.com|youtu\.be)\/.+$/;
    if (!youtubeRegex.test(url)) {
      throw new ValidationError("Invalid YouTube URL provided.");
    }
  };

  validateYoutubeUrl(url);

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const response = await fetch(`${API_BASE_URL}${endpoint}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ url }),
        signal, // For cancellation
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => null);
        throw new ApiError(
          response.status,
          errorData?.message || "Unknown API error"
        );
      }

      return response; // Success
    } catch (error) {
      if (error.name === "AbortError") {
        // Request was cancelled
        throw error;
      }

      if (attempt === retries || !(error instanceof NetworkError || error instanceof ApiError)) {
        // No more retries or error is not retryable
        throw error;
      }

      console.warn(
        `API request failed (attempt ${attempt}/${retries}). Retrying in ${retryDelay}ms...`,
        error
      );
      await new Promise((resolve) => setTimeout(resolve, retryDelay));
    }
  }
};

// --- Fetch video information ---
const fetchVideoInfo = async (url, signal = null) => {
  try {
    const response = await makeApiRequest("/infoVideo", url, 3, 1000, signal);
    const videoInfo = await response.json();

    // More specific validation example:
    if (!videoInfo || !videoInfo.title || !videoInfo.formats) {
      throw new ValidationError(
        "Invalid video info data received from server. Missing required fields."
      );
    }

    return videoInfo;
  } catch (error) {
    console.error("Error fetching video info:", error);
    if (
      error instanceof ApiError &&
      (error.status === 404 || error.status === 400)
    ) {
      // Handle specific API error codes (e.g., not found or bad request)
      throw new ValidationError("Video not found or invalid URL.");
    }
    throw error; // Re-throw other errors
  }
};

// --- Download video ---
const downloadVideo = (url, signal = null) => {
  return makeApiRequest("/download", url, 3, 1000, signal);
};

// --- Example usage with cancellation ---
const controller = new AbortController();
const signal = controller.signal;

// Fetch video info (can be cancelled)
fetchVideoInfo("your_youtube_url", signal)
  .then((videoInfo) => {
    console.log("Video Info:", videoInfo);

    // Start download (can also be cancelled)
    return downloadVideo("your_youtube_url", signal);
  })
  .then((response) => {
    // Handle download stream
    if (!response.ok) {
      throw new Error(`Download failed with status ${response.status}`);
    }
    const reader = response.body.getReader();
    return new ReadableStream({
      start(controller) {
        function pump() {
          return reader.read().then(({ done, value }) => {
            if (done) {
              controller.close();
              return;
            }
            controller.enqueue(value);
            return pump();
          });
        }
        return pump();
      },
    });
  })
  .then((stream) => {
    // Example: Get a new response with the stream as body
    // This is a common way to handle downloads in the browser
    return new Response(stream);
  })
  .then(async (response) => {
    // Example: Convert the stream to a blob and create a download link
    const blob = await response.blob();
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "video.mp4"; // You might want to get the filename from videoInfo
    document.body.appendChild(a);
    a.click();
    window.URL.revokeObjectURL(url);
  })
  .catch((error) => {
    if (error.name === "AbortError") {
      console.log("Request cancelled by user.");
    } else if (error instanceof ValidationError) {
      console.error("Validation Error:", error.message);
    } else {
      console.error("An error occurred:", error);
    }
  });

// To cancel the request:
// controller.abort();

export default { fetchVideoInfo, downloadVideo };
