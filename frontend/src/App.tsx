import { useEffect, useRef, useState } from "react";
import "./App.css";
import { simplifyText } from "./services/api.js";
import {
  buildSimplifyInputFromDocument,
  getDocumentApiBaseUrl,
  predictDocumentTypeFromFile,
  resizeImageBeforeUpload,
  type DocumentPredictionResult,
} from "./services/documentPredict";

function App() {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  const [documentResult, setDocumentResult] =
    useState<DocumentPredictionResult | null>(null);
  const [imageDescriptionResult, setImageDescriptionResult] = useState<any>(null);

  const [readingText, setReadingText] = useState("");
  const [cardIdForSimplify, setCardIdForSimplify] = useState("");
  const [simplifiedText, setSimplifiedText] = useState("");
  const [simplifySource, setSimplifySource] = useState("");
  const [pipelineStep, setPipelineStep] = useState<
    null | "identifying" | "simplifying"
  >(null);

  const [documentLoading, setDocumentLoading] = useState(false);
  const [descriptionLoading, setDescriptionLoading] = useState(false);

  const [cameraActive, setCameraActive] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [cameraReady, setCameraReady] = useState(false);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const apiBase = getDocumentApiBaseUrl();
  const IMAGE_DESCRIPTION_API_URL = `${apiBase.replace(/\/$/, "")}/image/describe-image`;

  useEffect(() => {
    if (!cameraActive) return;

    const openCamera = async () => {
      setCameraError(null);
      setCameraReady(false);

      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            width: { ideal: 1280 },
            height: { ideal: 720 },
          },
          audio: false,
        });

        streamRef.current = stream;

        if (videoRef.current) {
          videoRef.current.srcObject = stream;

          videoRef.current.onloadedmetadata = async () => {
            try {
              await videoRef.current?.play();
              setCameraReady(true);
            } catch (error) {
              console.error(error);
              setCameraError("Camera preview failed to start.");
            }
          };
        }
      } catch (error) {
        console.error(error);
        setCameraError(
          "Camera access failed. Please allow camera permission or close other apps using the camera."
        );
        setCameraActive(false);
      }
    };

    openCamera();

    return () => {
      stopCamera();
    };
  }, [cameraActive]);

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];

    if (!file) return;

    stopCamera();

    setSelectedFile(file);
    setPreviewUrl(URL.createObjectURL(file));
    setDocumentResult(null);
    setImageDescriptionResult(null);
    setSimplifiedText("");
    setSimplifySource("");
    setPipelineStep(null);
  };

  const startCamera = () => {
    setPreviewUrl(null);
    setSelectedFile(null);
    setDocumentResult(null);
    setImageDescriptionResult(null);
    setSimplifiedText("");
    setSimplifySource("");
    setPipelineStep(null);
    setCameraError(null);
    setCameraReady(false);
    setCameraActive(true);
  };

  const stopCamera = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }

    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }

    setCameraReady(false);
    setCameraActive(false);
  };

  const capturePhoto = () => {
    if (!videoRef.current) {
      alert("Camera is not ready.");
      return;
    }

    const video = videoRef.current;

    if (video.videoWidth === 0 || video.videoHeight === 0) {
      alert("Camera is still loading. Please wait a few seconds and try again.");
      return;
    }

    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;

    const context = canvas.getContext("2d");

    if (!context) {
      alert("Could not capture image.");
      return;
    }

    context.drawImage(video, 0, 0, canvas.width, canvas.height);

    const dataUrl = canvas.toDataURL("image/jpeg", 0.95);

    fetch(dataUrl)
      .then((res) => res.blob())
      .then((blob) => {
        const file = new File([blob], "captured_document.jpg", {
          type: "image/jpeg",
        });

        setSelectedFile(file);
        setPreviewUrl(dataUrl);
        setDocumentResult(null);
        setImageDescriptionResult(null);
        setSimplifiedText("");
        setSimplifySource("");
        setPipelineStep(null);

        stopCamera();
      })
      .catch((error) => {
        console.error(error);
        alert("Could not create captured image.");
      });
  };

  const predictDocument = async () => {
    if (!selectedFile) {
      alert("Please select or capture an image first.");
      return;
    }

    setDocumentLoading(true);
    setDocumentResult(null);

    try {
      const data = await predictDocumentTypeFromFile(selectedFile);
      setDocumentResult(data);
    } catch (error) {
      console.error(error);
      alert("Document prediction failed. Please check backend is running.");
    } finally {
      setDocumentLoading(false);
    }
  };

  const identifyDocumentThenSimplify = async () => {
    if (!selectedFile) {
      alert("Please select or capture a document image first.");
      return;
    }
    if (!readingText.trim()) {
      alert("Please enter the reading text to simplify.");
      return;
    }
    const card = cardIdForSimplify.trim().toUpperCase();
    if (!card) {
      alert("Please enter a card ID (RFID) so text can be simplified for that user profile.");
      return;
    }

    setDocumentResult(null);
    setSimplifiedText("");
    setSimplifySource("");
    setPipelineStep("identifying");

    try {
      const doc = await predictDocumentTypeFromFile(selectedFile);
      setDocumentResult(doc);
      setPipelineStep("simplifying");
      const textForSimplifier = buildSimplifyInputFromDocument(doc, readingText);
      const result = await simplifyText(card, textForSimplifier);
      setSimplifiedText(result.simplified_text);
      setSimplifySource(result.source ?? "");
    } catch (error) {
      console.error(error);
      alert(
        "Pipeline failed. Ensure the document backend and reading API (VITE_API_BASE_URL) are running, and the card ID is registered."
      );
    } finally {
      setPipelineStep(null);
    }
  };

  const describeImage = async () => {
    if (!selectedFile) {
      alert("Please select or capture an image first.");
      return;
    }

    setDescriptionLoading(true);
    setImageDescriptionResult(null);

    try {
      const resizedFile = await resizeImageBeforeUpload(selectedFile);

      const formData = new FormData();
      formData.append("file", resizedFile);

      const response = await fetch(IMAGE_DESCRIPTION_API_URL, {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        throw new Error("Backend returned an error.");
      }

      const data = await response.json();
      setImageDescriptionResult(data);
    } catch (error) {
      console.error(error);
      alert("Image description failed. Please check backend and OpenAI API key.");
    } finally {
      setDescriptionLoading(false);
    }
  };

  return (
    <div className="page">
      <div className="container">
        <header className="header">
          <h1>Smart Wearable Reading Assistant</h1>
          <p>
            Document identification, reading text simplification (sequential pipeline), and
            inside-page image description.
          </p>
        </header>

        <div className="grid">
          <section className="card upload-card">
            <h2>Upload or Capture Page</h2>

            <p className="small-text">
              Upload a printed document image or inside page image.
            </p>

            <div className="action-row">
              <label className="file-label">
                Browse Image
                <input
                  type="file"
                  accept="image/*"
                  onChange={handleFileChange}
                  className="hidden-input"
                />
              </label>

              <button
                type="button"
                onClick={cameraActive ? stopCamera : startCamera}
                className="camera-btn"
              >
                {cameraActive ? "Close Camera" : "Open Camera"}
              </button>
            </div>

            {cameraError && <p className="error-text">{cameraError}</p>}

            {cameraActive && (
              <div className="camera-box">
                <video
                  ref={videoRef}
                  autoPlay
                  playsInline
                  muted
                  className="camera-preview"
                />

                <p className="small-text">
                  {cameraReady
                    ? "Camera ready. Place the document clearly and capture."
                    : "Camera loading... please wait."}
                </p>

                <button
                  type="button"
                  onClick={capturePhoto}
                  className="capture-btn"
                  disabled={!cameraReady}
                >
                  Capture Photo
                </button>
              </div>
            )}

            {previewUrl && (
              <div className="preview-box">
                <img src={previewUrl} alt="Selected document" />
              </div>
            )}

            <h3 className="section-title" style={{ marginTop: "1.25rem" }}>
              Reading text &amp; pipeline
            </h3>
            <p className="small-text">
              Enter the passage to simplify. The system first classifies the uploaded page image,
              then sends the identification summary together with your text to the simplification
              API (registered card ID required).
            </p>
            <label className="small-text" style={{ display: "block", marginTop: "0.5rem" }}>
              Card ID (user profile for /simplify)
            </label>
            <input
              type="text"
              value={cardIdForSimplify}
              onChange={(e) => setCardIdForSimplify(e.target.value)}
              placeholder="e.g. T001"
              style={{ width: "100%", marginBottom: "0.5rem", padding: "0.5rem" }}
            />
            <label className="small-text" style={{ display: "block" }}>
              Reading text
            </label>
            <textarea
              value={readingText}
              onChange={(e) => setReadingText(e.target.value)}
              placeholder="Paste the text to simplify after document identification…"
              rows={5}
              style={{ width: "100%", marginBottom: "0.75rem", padding: "0.5rem" }}
            />

            {pipelineStep === "identifying" && (
              <p className="small-text" aria-live="polite">
                Identifying document…
              </p>
            )}
            {pipelineStep === "simplifying" && (
              <p className="small-text" aria-live="polite">
                Simplifying text…
              </p>
            )}

            <button
              type="button"
              onClick={() => void identifyDocumentThenSimplify()}
              disabled={
                documentLoading ||
                descriptionLoading ||
                pipelineStep !== null
              }
              className="predict-btn"
            >
              {pipelineStep === "identifying"
                ? "Identifying…"
                : pipelineStep === "simplifying"
                  ? "Simplifying…"
                  : "Identify document & simplify text"}
            </button>

            <button
              onClick={predictDocument}
              disabled={
                documentLoading || descriptionLoading || pipelineStep !== null
              }
              className="predict-btn"
            >
              {documentLoading ? "Predicting..." : "Predict Document"}
            </button>

            <button
              onClick={describeImage}
              disabled={
                documentLoading || descriptionLoading || pipelineStep !== null
              }
              className="describe-btn"
            >
              {descriptionLoading ? "Describing..." : "Describe Image"}
            </button>
          </section>

          <section className="card result-card">
            <h2>Model Output</h2>

            {!documentResult && !imageDescriptionResult && !simplifiedText && (
              <p className="empty-text">
                Results will appear here after prediction, the identify→simplify pipeline, or
                image description.
              </p>
            )}

            {documentResult && (
              <div className="result-content">
                <h3 className="section-title">Document Identification Result</h3>

                <div className="result-row">
                  <span>Document Type</span>
                  <strong>{documentResult.document_type}</strong>
                </div>

                <div className="result-row">
                  <span>Confidence</span>
                  <strong>{documentResult.confidence}%</strong>
                </div>

                <div className="result-row">
                  <span>Detected Title</span>
                  <strong>
                    {documentResult.title ? documentResult.title : "Not needed"}
                  </strong>
                </div>

                <div className="message-box">
                  <h3>Final Device Message</h3>
                  <p>{documentResult.final_message}</p>
                </div>

                <div className="predictions">
                  <h3>Top Predictions</h3>

                  {documentResult.all_predictions?.map(
                    (item: any, index: number) => (
                      <div className="prediction-item" key={index}>
                        <span>{item.class_name}</span>
                        <span>{item.confidence}%</span>
                      </div>
                    )
                  )}
                </div>
              </div>
            )}

            {imageDescriptionResult && (
              <div className="result-content image-description-output">
                <h3 className="section-title">Image Description Result</h3>

                <div className="message-box description-box">
                  <h3>Simple Description</h3>
                  <p>{imageDescriptionResult.description}</p>
                </div>

                <div className="message-box">
                  <h3>Final Device Message</h3>
                  <p>{imageDescriptionResult.final_message}</p>
                </div>
              </div>
            )}

            {simplifiedText ? (
              <div className="result-content">
                <h3 className="section-title">Simplified reading output</h3>
                <div className="message-box">
                  <p style={{ whiteSpace: "pre-wrap" }}>{simplifiedText}</p>
                </div>
                {simplifySource ? (
                  <p className="small-text">
                    <strong>Source:</strong> {simplifySource}
                  </p>
                ) : null}
              </div>
            ) : null}
          </section>
        </div>
      </div>
    </div>
  );
}

export default App;