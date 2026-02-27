/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { 
  Camera, 
  Upload, 
  FileText, 
  Trash2, 
  Download, 
  ChevronLeft, 
  ChevronRight,
  Check, 
  X, 
  Plus,
  Maximize2,
  History,
  Settings,
  Zap,
  RefreshCw,
  Image as ImageIcon,
  MoreVertical,
  Share2,
  ExternalLink,
  FileUp,
  Cloud
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { jsPDF } from 'jspdf';
import { GoogleGenAI } from "@google/genai";
import { db, type ScannedDocument } from './db';
import { cn, type Point, applyTransform } from './utils';

type AppState = 'home' | 'capture' | 'crop' | 'preview' | 'batch' | 'ocr';
type ScanMode = 'document' | 'book' | 'id_card';

export default function App() {
  const [state, setState] = useState<AppState>('home');
  const [scanMode, setScanMode] = useState<ScanMode>('document');
  const [scans, setScans] = useState<ScannedDocument[]>([]);
  const [currentImage, setCurrentImage] = useState<string | null>(null);
  const [processedImage, setProcessedImage] = useState<string | null>(null);
  const [batchImages, setBatchImages] = useState<string[]>([]);
  const [selectedScanIds, setSelectedScanIds] = useState<number[]>([]);
  const [isSelectionMode, setIsSelectionMode] = useState(false);
  const [isRenaming, setIsRenaming] = useState<number | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [extractedText, setExtractedText] = useState<string | null>(null);
  const [isExtracting, setIsExtracting] = useState(false);
  const [editingScanId, setEditingScanId] = useState<number | null>(null);
  const [viewingScan, setViewingScan] = useState<ScannedDocument | null>(null);
  const [activeMenuId, setActiveMenuId] = useState<number | null>(null);
  const [googleTokens, setGoogleTokens] = useState<any>(null);
  const [isUploadingToDrive, setIsUploadingToDrive] = useState(false);
  const [batchTotal, setBatchTotal] = useState(0);
  const [compressPDF, setCompressPDF] = useState(true);
  const [idCardSide, setIdCardSide] = useState<'front' | 'back' | null>(null);
  const [idCardFront, setIdCardFront] = useState<string | null>(null);
  const [corners, setCorners] = useState<Point[]>([
    { x: 50, y: 50 },
    { x: 250, y: 50 },
    { x: 250, y: 350 },
    { x: 50, y: 350 }
  ]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [uploadQueue, setUploadQueue] = useState<string[]>([]);
  const [rotation, setRotation] = useState(0);
  
  const [isAutoDetecting, setIsAutoDetecting] = useState(false);
  const [magnifierPos, setMagnifierPos] = useState<{ x: number, y: number, displayX: number, displayY: number } | null>(null);
  
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cropImageRef = useRef<HTMLImageElement>(null);
  const cropContainerRef = useRef<HTMLDivElement>(null);

  // Load scans from DB
  useEffect(() => {
    const loadScans = async () => {
      const allScans = await db.scans.orderBy('createdAt').reverse().toArray();
      setScans(allScans);
    };
    loadScans();
  }, [state]);

  // Listen for Google Auth
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (event.data?.type === 'GOOGLE_AUTH_SUCCESS') {
        setGoogleTokens(event.data.tokens);
        alert("Google Drive connected!");
      }
    };
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, []);

  const copyToGoogleDrive = async (scan: ScannedDocument) => {
    if (!googleTokens) {
      // Open Auth Popup
      try {
        const res = await fetch('/api/auth/google/url');
        const { url } = await res.json();
        window.open(url, 'google_auth', 'width=600,height=700');
      } catch (error) {
        console.error("Auth URL error:", error);
      }
      return;
    }

    setIsUploadingToDrive(true);
    try {
      const res = await fetch('/api/drive/upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tokens: googleTokens,
          name: scan.name,
          image: scan.processedImage
        })
      });
      if (res.ok) {
        alert("Successfully uploaded to Google Drive!");
      } else {
        throw new Error("Upload failed");
      }
    } catch (error) {
      console.error("Drive upload error:", error);
      alert("Failed to upload to Google Drive.");
    } finally {
      setIsUploadingToDrive(false);
    }
  };

  const autoDetectCorners = async () => {
    if (!currentImage) return;
    setIsAutoDetecting(true);
    
    try {
      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });
      
      const base64Data = currentImage.split(',')[1];
      
      const response = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: [
          {
            role: "user",
            parts: [
              {
                inlineData: {
                  mimeType: "image/jpeg",
                  data: base64Data
                }
              },
              {
                text: `Find the four corners of the document in this image. The scan mode is ${scanMode}. Return the coordinates as a JSON array of 4 objects with x and y properties. The coordinates should be in pixels relative to the original image dimensions. Order them: top-left, top-right, bottom-right, bottom-left.`
              }
            ]
          }
        ],
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: "ARRAY" as any,
            items: {
              type: "OBJECT" as any,
              properties: {
                x: { type: "NUMBER" as any },
                y: { type: "NUMBER" as any }
              },
              required: ["x", "y"]
            }
          }
        }
      });

      const detectedCorners = JSON.parse(response.text);
      if (Array.isArray(detectedCorners) && detectedCorners.length === 4) {
        setCorners(detectedCorners);
      }
    } catch (err) {
      console.error("Auto-detect failed:", err);
      alert("Auto-detection failed. Please adjust corners manually.");
    } finally {
      setIsAutoDetecting(false);
    }
  };

  const startCamera = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ 
        video: { 
          facingMode: 'environment',
          width: { ideal: 1920 },
          height: { ideal: 1080 }
        } 
      });
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }
      setState('capture');
      if (scanMode === 'id_card') {
        setIdCardSide('front');
      } else {
        setIdCardSide(null);
      }
    } catch (err) {
      console.error("Error accessing camera:", err);
      alert("Could not access camera. Please check permissions.");
    }
  };

  const stopCamera = () => {
    if (videoRef.current && videoRef.current.srcObject) {
      const stream = videoRef.current.srcObject as MediaStream;
      stream.getTracks().forEach(track => track.stop());
    }
  };

  const setInitialCorners = (img: HTMLImageElement) => {
    const w = img.naturalWidth;
    const h = img.naturalHeight;
    
    let initialCorners: Point[];
    
    if (scanMode === 'id_card') {
      initialCorners = [
        { x: w * 0.2, y: h * 0.3 },
        { x: w * 0.8, y: h * 0.3 },
        { x: w * 0.8, y: h * 0.7 },
        { x: w * 0.2, y: h * 0.7 }
      ];
    } else if (scanMode === 'book') {
      initialCorners = [
        { x: w * 0.05, y: h * 0.05 },
        { x: w * 0.95, y: h * 0.05 },
        { x: w * 0.95, y: h * 0.95 },
        { x: w * 0.05, y: h * 0.95 }
      ];
    } else {
      initialCorners = [
        { x: w * 0.02, y: h * 0.02 },
        { x: w * 0.98, y: h * 0.02 },
        { x: w * 0.98, y: h * 0.98 },
        { x: w * 0.02, y: h * 0.98 }
      ];
    }
    setCorners(initialCorners);
  };

  const captureImage = () => {
    if (videoRef.current && canvasRef.current) {
      const video = videoRef.current;
      const canvas = canvasRef.current;
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext('2d');
      ctx?.drawImage(video, 0, 0);
      const dataUrl = canvas.toDataURL('image/jpeg', 0.9);
      setCurrentImage(dataUrl);
      
      const tempImg = new Image();
      tempImg.onload = () => setInitialCorners(tempImg);
      tempImg.src = dataUrl;
      
      stopCamera();
      setState('crop');
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []).slice(0, 100) as File[];
    if (files.length === 0) return;
    if (files.length === 100) {
      alert("Maximum 100 images allowed at once.");
    }

    const readers = files.map(file => {
      return new Promise<string>((resolve) => {
        const reader = new FileReader();
        reader.onload = (event) => resolve(event.target?.result as string);
        reader.readAsDataURL(file);
      });
    });

    const dataUrls = await Promise.all(readers);
    
    setBatchTotal(dataUrls.length);
    if (dataUrls.length > 1) {
      setUploadQueue(dataUrls.slice(1));
    }
    
    const firstImage = dataUrls[0];
    setCurrentImage(firstImage);
    setRotation(0);
    
    const img = new Image();
    img.onload = () => {
      setInitialCorners(img);
      setState('crop');
    };
    img.src = firstImage;
  };

  const nextInQueue = () => {
    if (uploadQueue.length > 0) {
      const nextImage = uploadQueue[0];
      setUploadQueue(prev => prev.slice(1));
      setCurrentImage(nextImage);
      setRotation(0);
      const img = new Image();
      img.onload = () => {
        setInitialCorners(img);
        setState('crop');
      };
      img.src = nextImage;
    } else {
      setState('batch');
    }
  };

  const processCrop = async () => {
    if (!currentImage) return;
    setIsProcessing(true);
    
    const img = new Image();
    img.onload = () => {
      // Calculate distances to determine target aspect ratio
      const topWidth = Math.sqrt(Math.pow(corners[1].x - corners[0].x, 2) + Math.pow(corners[1].y - corners[0].y, 2));
      const bottomWidth = Math.sqrt(Math.pow(corners[2].x - corners[3].x, 2) + Math.pow(corners[2].y - corners[3].y, 2));
      const leftHeight = Math.sqrt(Math.pow(corners[3].x - corners[0].x, 2) + Math.pow(corners[3].y - corners[0].y, 2));
      const rightHeight = Math.sqrt(Math.pow(corners[2].x - corners[1].x, 2) + Math.pow(corners[2].y - corners[1].y, 2));
      
      const avgWidth = (topWidth + bottomWidth) / 2;
      const avgHeight = (leftHeight + rightHeight) / 2;
      
      if (avgWidth < 10 || avgHeight < 10) {
        alert("Selected area is too small. Please adjust corners.");
        setIsProcessing(false);
        return;
      }
      
      // Maintain high resolution while keeping aspect ratio
      const maxDim = 2400;
      let targetWidth, targetHeight;
      if (avgWidth > avgHeight) {
        targetWidth = maxDim;
        targetHeight = Math.round((avgHeight / avgWidth) * maxDim);
      } else {
        targetHeight = maxDim;
        targetWidth = Math.round((avgWidth / avgHeight) * maxDim);
      }

      const canvas = document.createElement('canvas');
      canvas.width = targetWidth;
      canvas.height = targetHeight;
      const ctx = canvas.getContext('2d');
      
      if (ctx) {
        // If rotation is applied, we need to rotate the source image first
        if (rotation !== 0) {
          const rotateCanvas = document.createElement('canvas');
          const rCtx = rotateCanvas.getContext('2d');
          if (rCtx) {
            const isPortrait = rotation % 180 !== 0;
            rotateCanvas.width = isPortrait ? img.naturalHeight : img.naturalWidth;
            rotateCanvas.height = isPortrait ? img.naturalWidth : img.naturalHeight;
            
            rCtx.translate(rotateCanvas.width / 2, rotateCanvas.height / 2);
            rCtx.rotate((rotation * Math.PI) / 180);
            rCtx.drawImage(img, -img.naturalWidth / 2, -img.naturalHeight / 2);
            
            const rotatedImg = new Image();
            rotatedImg.onload = () => {
              applyTransform(ctx, rotatedImg, corners, targetWidth, targetHeight);
              setProcessedImage(canvas.toDataURL('image/jpeg', 0.9));
              setState('preview');
              setIsProcessing(false);
            };
            rotatedImg.src = rotateCanvas.toDataURL();
            return;
          }
        }

        applyTransform(ctx, img, corners, targetWidth, targetHeight);
        setProcessedImage(canvas.toDataURL('image/jpeg', 0.9));
        setState('preview');
      }
      setIsProcessing(false);
    };
    img.src = currentImage;
  };

  const saveScan = async () => {
    if (!currentImage || !processedImage) return;
    
    if (editingScanId) {
      await db.scans.update(editingScanId, { 
        processedImage, 
        corners 
      });
      setScans(scans.map(s => s.id === editingScanId ? { ...s, processedImage, corners } : s));
      setEditingScanId(null);
      setCurrentImage(null);
      setProcessedImage(null);
      setState('home');
      return;
    }

    if (scanMode === 'id_card' && idCardSide === 'front') {
      setIdCardFront(processedImage);
      setIdCardSide('back');
      setCurrentImage(null);
      setProcessedImage(null);
      startCamera();
      return;
    }

    if (scanMode === 'id_card' && idCardSide === 'back' && idCardFront) {
      // Combine front and back into one image
      const canvas = document.createElement('canvas');
      const frontImg = new Image();
      const backImg = new Image();
      
      await Promise.all([
        new Promise(r => { frontImg.onload = r; frontImg.src = idCardFront; }),
        new Promise(r => { backImg.onload = r; backImg.src = processedImage; })
      ]);

      canvas.width = Math.max(frontImg.width, backImg.width);
      canvas.height = frontImg.height + backImg.height + 40; // 40px gap
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.fillStyle = 'white';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(frontImg, (canvas.width - frontImg.width) / 2, 0);
        ctx.drawImage(backImg, (canvas.width - backImg.width) / 2, frontImg.height + 40);
        const combined = canvas.toDataURL('image/jpeg', 0.9);
        setBatchImages(prev => [...prev, combined]);
      }
      setIdCardFront(null);
      setIdCardSide(null);
    } else {
      setBatchImages(prev => [...prev, processedImage]);
    }

    setCurrentImage(null);
    setProcessedImage(null);
    
    if (uploadQueue.length > 0) {
      nextInQueue();
    } else {
      setState('batch');
    }
  };

  const finishBatch = async () => {
    if (batchImages.length === 0) return;
    
    const timestamp = new Date().toLocaleString();
    for (let i = 0; i < batchImages.length; i++) {
      const newScan: ScannedDocument = {
        name: `Scan ${timestamp} (Page ${i + 1})`,
        originalImage: batchImages[i], // We don't have original for all in this simple batch, using processed
        processedImage: batchImages[i],
        createdAt: Date.now(),
        corners: corners
      };
      await db.scans.add(newScan);
    }
    
    setBatchImages([]);
    setState('home');
  };

  const extractText = async (imageUrl: string) => {
    setIsExtracting(true);
    setState('ocr');
    try {
      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });
      const response = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: [
          {
            parts: [
              { text: "Extract all text from this scanned document image. Return only the text content." },
              { inlineData: { mimeType: "image/jpeg", data: imageUrl.split(',')[1] } }
            ]
          }
        ]
      });
      setExtractedText(response.text || "No text found.");
    } catch (error) {
      console.error("OCR Error:", error);
      setExtractedText("Failed to extract text.");
    } finally {
      setIsExtracting(false);
    }
  };

  const renameScan = async (id: number, newName: string) => {
    await db.scans.update(id, { name: newName });
    setScans(scans.map(s => s.id === id ? { ...s, name: newName } : s));
    setIsRenaming(null);
  };

  const editScan = (scan: ScannedDocument) => {
    setEditingScanId(scan.id!);
    setCurrentImage(scan.originalImage);
    setCorners(scan.corners);
    setRotation(0);
    setState('crop');
  };

  const shareScan = async (scan: ScannedDocument) => {
    if (navigator.share) {
      try {
        const blob = await (await fetch(scan.processedImage)).blob();
        const file = new File([blob], `${scan.name}.jpg`, { type: 'image/jpeg' });
        await navigator.share({
          files: [file],
          title: scan.name,
          text: `Check out this scan: ${scan.name}`
        });
      } catch (error) {
        console.error("Share error:", error);
      }
    } else {
      shareToWhatsApp(scan);
    }
  };

  const shareToWhatsApp = (scan: ScannedDocument) => {
    const text = encodeURIComponent(`Check out this scan: ${scan.name}`);
    window.open(`https://wa.me/?text=${text}`, '_blank');
  };

  const shareToGmail = (scan: ScannedDocument) => {
    const subject = encodeURIComponent(scan.name);
    const body = encodeURIComponent(`Check out this scan: ${scan.name}`);
    window.open(`mailto:?subject=${subject}&body=${body}`, '_blank');
  };

  const rotateProcessedImage = () => {
    if (!processedImage) return;
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.height;
      canvas.height = img.width;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.translate(canvas.width / 2, canvas.height / 2);
        ctx.rotate(Math.PI / 2);
        ctx.drawImage(img, -img.width / 2, -img.height / 2);
        setProcessedImage(canvas.toDataURL('image/jpeg', 0.9));
      }
    };
    img.src = processedImage;
  };

  const applyFilter = (filterType: 'enhance' | 'bw') => {
    if (!processedImage) return;
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.drawImage(img, 0, 0);
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const data = imageData.data;

        if (filterType === 'bw') {
          for (let i = 0; i < data.length; i += 4) {
            const avg = (data[i] + data[i + 1] + data[i + 2]) / 3;
            data[i] = avg;
            data[i + 1] = avg;
            data[i + 2] = avg;
          }
        } else if (filterType === 'enhance') {
          const factor = 1.3;
          for (let i = 0; i < data.length; i += 4) {
            data[i] = Math.min(255, Math.max(0, factor * (data[i] - 128) + 128));
            data[i + 1] = Math.min(255, Math.max(0, factor * (data[i + 1] - 128) + 128));
            data[i + 2] = Math.min(255, Math.max(0, factor * (data[i + 2] - 128) + 128));
          }
        }

        ctx.putImageData(imageData, 0, 0);
        setProcessedImage(canvas.toDataURL('image/jpeg', 0.9));
      }
    };
    img.src = processedImage;
  };
  const downloadPDF = (scan: ScannedDocument) => {
    const pdf = new jsPDF({
      compress: compressPDF, // Use compression option
    });
    const imgProps = pdf.getImageProperties(scan.processedImage);
    const pdfWidth = pdf.internal.pageSize.getWidth();
    const pdfHeight = (imgProps.height * pdfWidth) / imgProps.width;
    
    // Use JPEG with quality 0.7 for ~80% reduction if original was high quality
    const quality = compressPDF ? 0.7 : 1.0;
    pdf.addImage(scan.processedImage, 'JPEG', 0, 0, pdfWidth, pdfHeight, undefined, compressPDF ? 'FAST' : 'SLOW');
    pdf.save(`${scan.name}.pdf`);
  };

  const downloadSelectedAsPDF = async () => {
    if (selectedScanIds.length === 0) return;
    const selectedScans = scans.filter(s => selectedScanIds.includes(s.id!));
    const pdf = new jsPDF({ compress: compressPDF });
    
    for (let i = 0; i < selectedScans.length; i++) {
      const scan = selectedScans[i];
      const imgProps = pdf.getImageProperties(scan.processedImage);
      const pdfWidth = pdf.internal.pageSize.getWidth();
      const pdfHeight = (imgProps.height * pdfWidth) / imgProps.width;
      
      if (i > 0) pdf.addPage();
      const quality = compressPDF ? 0.7 : 1.0;
      pdf.addImage(scan.processedImage, 'JPEG', 0, 0, pdfWidth, pdfHeight, undefined, compressPDF ? 'FAST' : 'SLOW');
    }
    
    pdf.save(`Combined_Scan_${new Date().getTime()}.pdf`);
    setIsSelectionMode(false);
    setSelectedScanIds([]);
  };

  const toggleSelection = (id: number) => {
    setSelectedScanIds(prev => 
      prev.includes(id) ? prev.filter(sid => sid !== id) : [...prev, id]
    );
  };

  const deleteScan = async (id: number) => {
    if (confirm("Delete this scan?")) {
      await db.scans.delete(id);
      setScans(scans.filter(s => s.id !== id));
    }
  };

  return (
    <div className="h-screen bg-[#F5F5F5] text-[#1A1A1A] font-sans selection:bg-emerald-100 flex flex-col overflow-hidden">
      <input 
        type="file" 
        ref={fileInputRef} 
        onChange={handleFileUpload} 
        className="hidden" 
        accept="image/*"
        multiple
      />
      {/* Header */}
      <header className="sticky top-0 z-50 bg-white/80 backdrop-blur-md border-b border-black/5 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 bg-emerald-600 rounded-lg flex items-center justify-center text-white">
            <Maximize2 size={20} />
          </div>
          <h1 className="text-xl font-semibold tracking-tight">LuminaScan</h1>
        </div>
        {state === 'home' && (
          <div className="flex items-center gap-4">
            <button 
              onClick={() => setCompressPDF(!compressPDF)}
              className={cn(
                "px-3 py-1.5 rounded-full text-[10px] font-bold uppercase tracking-wider transition-all border",
                compressPDF ? "bg-emerald-50 border-emerald-200 text-emerald-700" : "bg-zinc-50 border-zinc-200 text-zinc-500"
              )}
            >
              Compress: {compressPDF ? "ON" : "OFF"}
            </button>
            {scans.length > 0 && (
              <button 
                onClick={() => {
                  setIsSelectionMode(!isSelectionMode);
                  setSelectedScanIds([]);
                }}
                className={cn(
                  "px-3 py-1.5 rounded-full text-sm font-medium transition-colors",
                  isSelectionMode ? "bg-emerald-100 text-emerald-700" : "text-zinc-500 hover:text-zinc-900"
                )}
              >
                {isSelectionMode ? "Cancel" : "Select"}
              </button>
            )}
            <button className="p-2 text-zinc-500 hover:text-zinc-900 transition-colors">
              <History size={20} />
            </button>
          </div>
        )}
      </header>

      <main className="flex-1 w-full max-w-none p-0 md:p-6 overflow-hidden flex flex-col">
        <div className="max-w-6xl mx-auto w-full h-full flex flex-col overflow-hidden">
          <AnimatePresence mode="wait">
            {state === 'home' && (
              <motion.div 
                key="home"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
                className="flex-1 overflow-y-auto no-scrollbar flex flex-col"
              >
                <div className="space-y-8 p-6 pb-32">
                  {/* Scan Mode Selector */}
                  <div className="grid grid-cols-3 gap-2 shrink-0">
                    {(['document', 'book', 'id_card'] as ScanMode[]).map((mode) => (
                      <button
                        key={mode}
                        onClick={() => setScanMode(mode)}
                        className={cn(
                          "flex flex-col items-center gap-1.5 p-3 rounded-2xl border transition-all active:scale-95",
                          scanMode === mode 
                            ? "bg-emerald-50 border-emerald-200 text-emerald-700 shadow-sm" 
                            : "bg-white border-black/5 text-zinc-500 hover:bg-zinc-50"
                        )}
                      >
                        <div className={cn(
                          "w-8 h-8 rounded-lg flex items-center justify-center",
                          scanMode === mode ? "bg-emerald-100" : "bg-zinc-100"
                        )}>
                          {mode === 'document' && <FileText size={16} />}
                          {mode === 'book' && <History size={16} />}
                          {mode === 'id_card' && <Maximize2 size={16} />}
                        </div>
                        <span className="text-[10px] font-bold uppercase tracking-wider">{mode.replace('_', ' ')}</span>
                      </button>
                    ))}
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 shrink-0">
                    <button 
                      onClick={startCamera}
                      className="group relative h-28 bg-emerald-600 rounded-2xl p-5 flex flex-col justify-end overflow-hidden transition-all hover:bg-emerald-700 hover:shadow-xl hover:shadow-emerald-900/20 active:scale-[0.98]"
                    >
                      <div className="absolute top-3 right-3 text-white/20 group-hover:text-white/30 transition-colors">
                        <Camera size={48} />
                      </div>
                      <div className="relative z-10 text-left">
                        <p className="text-emerald-100/60 text-[9px] font-medium uppercase tracking-wider mb-0.5">New Document</p>
                        <h2 className="text-lg font-bold text-white leading-tight">Start Scanning</h2>
                      </div>
                    </button>

                    <button 
                      onClick={() => fileInputRef.current?.click()}
                      className="group relative h-28 bg-white border border-black/5 rounded-2xl p-5 flex flex-col justify-end overflow-hidden transition-all hover:border-emerald-200 hover:shadow-xl hover:shadow-emerald-900/5 active:scale-[0.98]"
                    >
                      <div className="absolute top-3 right-3 text-zinc-100 group-hover:text-emerald-50 transition-colors">
                        <Upload size={48} />
                      </div>
                      <div className="relative z-10 text-left">
                        <p className="text-zinc-400 text-[9px] font-medium uppercase tracking-wider mb-0.5">From Gallery</p>
                        <h2 className="text-lg font-bold text-zinc-800 leading-tight">Import Image</h2>
                      </div>
                    </button>
                  </div>

              {/* Library Section */}
              <section className="space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-lg font-semibold flex items-center gap-2">
                    Recent Scans
                    <span className="text-xs font-normal bg-zinc-200 text-zinc-600 px-2 py-0.5 rounded-full">
                      {scans.length}
                    </span>
                  </h3>
                </div>

                {scans.length === 0 ? (
                  <div className="bg-white border border-dashed border-zinc-300 rounded-3xl p-12 text-center space-y-4">
                    <div className="w-16 h-16 bg-zinc-50 rounded-full flex items-center justify-center mx-auto text-zinc-300">
                      <FileText size={32} />
                    </div>
                    <div className="space-y-1">
                      <p className="font-medium text-zinc-800">No documents yet</p>
                      <p className="text-sm text-zinc-500">Your scanned documents will appear here.</p>
                    </div>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 gap-2">
                    {scans.map((scan) => (
                      <motion.div 
                        layout
                        key={scan.id}
                        onClick={() => {
                          if (isSelectionMode) {
                            toggleSelection(scan.id!);
                          } else {
                            setViewingScan(scan);
                          }
                        }}
                        className={cn(
                          "group bg-white border rounded-lg transition-all cursor-pointer flex items-center p-1.5 gap-3 relative",
                          activeMenuId === scan.id ? "z-[60] shadow-md border-emerald-200" : "z-0",
                          isSelectionMode && selectedScanIds.includes(scan.id!) ? "border-emerald-500 ring-2 ring-emerald-500/20" : "border-black/5 hover:bg-zinc-50 shadow-sm"
                        )}
                      >
                        <div className="w-10 h-14 bg-zinc-100 rounded overflow-hidden flex-shrink-0 border border-black/5">
                          <img 
                            src={scan.processedImage} 
                            alt={scan.name} 
                            className="w-full h-full object-cover"
                          />
                        </div>
                        
                        <div className="flex-1 min-w-0">
                          {isRenaming === scan.id ? (
                            <div className="flex items-center gap-2" onClick={e => e.stopPropagation()}>
                              <input 
                                autoFocus
                                value={renameValue}
                                onChange={e => setRenameValue(e.target.value)}
                                onKeyDown={e => e.key === 'Enter' && renameScan(scan.id!, renameValue)}
                                className="flex-1 bg-zinc-100 border-none rounded px-2 py-1 text-xs font-medium focus:ring-2 focus:ring-emerald-500 outline-none"
                              />
                              <button onClick={() => renameScan(scan.id!, renameValue)} className="text-emerald-600"><Check size={14}/></button>
                              <button onClick={() => setIsRenaming(null)} className="text-zinc-400"><X size={14}/></button>
                            </div>
                          ) : (
                            <>
                              <h4 className="font-medium text-xs truncate text-zinc-800">{scan.name}</h4>
                              <p className="text-[9px] text-zinc-400">
                                {new Date(scan.createdAt).toLocaleDateString()} • {new Date(scan.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                              </p>
                            </>
                          )}
                        </div>

                        {!isSelectionMode && (
                          <div className="relative">
                            <button 
                              onClick={(e) => { 
                                e.stopPropagation(); 
                                setActiveMenuId(activeMenuId === scan.id ? null : scan.id!); 
                              }}
                              className="p-1.5 text-zinc-400 hover:text-zinc-900 hover:bg-zinc-100 rounded-md transition-colors"
                            >
                              <MoreVertical size={16} />
                            </button>
                            
                            <AnimatePresence>
                              {activeMenuId === scan.id && (
                                <>
                                  <div 
                                    className="fixed inset-0 z-[50] bg-black/5 backdrop-blur-[1px]" 
                                    onClick={(e) => { e.stopPropagation(); setActiveMenuId(null); }}
                                  />
                                  <motion.div 
                                    initial={{ opacity: 0, scale: 0.95, y: -10 }}
                                    animate={{ opacity: 1, scale: 1, y: 0 }}
                                    exit={{ opacity: 0, scale: 0.95, y: -10 }}
                                    className="absolute right-0 top-full mt-2 w-56 bg-white border border-zinc-200 rounded-2xl shadow-2xl z-[70] overflow-hidden py-2"
                                    onClick={e => e.stopPropagation()}
                                  >
                                    <button 
                                      onClick={() => { setViewingScan(scan); setActiveMenuId(null); }}
                                      className="w-full px-4 py-2.5 text-left text-sm font-medium text-zinc-700 hover:bg-zinc-50 flex items-center gap-3"
                                    >
                                      <Maximize2 size={16} /> View PDF
                                    </button>
                                    <button 
                                      onClick={() => { setIsRenaming(scan.id!); setRenameValue(scan.name); setActiveMenuId(null); }}
                                      className="w-full px-4 py-2.5 text-left text-sm font-medium text-zinc-700 hover:bg-zinc-50 flex items-center gap-3"
                                    >
                                      <History size={16} /> Rename
                                    </button>
                                    <button 
                                      onClick={() => { editScan(scan); setActiveMenuId(null); }}
                                      className="w-full px-4 py-2.5 text-left text-sm font-medium text-zinc-700 hover:bg-zinc-50 flex items-center gap-3"
                                    >
                                      <Settings size={16} /> Modify PDF
                                    </button>
                                    <button 
                                      onClick={() => { setCompressPDF(!compressPDF); setActiveMenuId(null); }}
                                      className="w-full px-4 py-2.5 text-left text-sm font-medium text-zinc-700 hover:bg-zinc-50 flex items-center gap-3"
                                    >
                                      <RefreshCw size={16} /> {compressPDF ? "Disable Compression" : "Enable Compression"}
                                    </button>
                                    <button 
                                      onClick={() => { extractText(scan.processedImage); setActiveMenuId(null); }}
                                      className="w-full px-4 py-2.5 text-left text-sm font-medium text-zinc-700 hover:bg-zinc-50 flex items-center gap-3"
                                    >
                                      <FileText size={16} /> OCR Extract
                                    </button>
                                    <div className="h-px bg-black/5 my-1" />
                                    <button 
                                      onClick={() => { shareToWhatsApp(scan); setActiveMenuId(null); }}
                                      className="w-full px-4 py-2.5 text-left text-sm font-medium text-emerald-700 hover:bg-emerald-50 flex items-center gap-3"
                                    >
                                      <Share2 size={16} /> Share WhatsApp
                                    </button>
                                    <button 
                                      onClick={() => { shareToGmail(scan); setActiveMenuId(null); }}
                                      className="w-full px-4 py-2.5 text-left text-sm font-medium text-red-700 hover:bg-red-50 flex items-center gap-3"
                                    >
                                      <ExternalLink size={16} /> Share Gmail
                                    </button>
                                    <button 
                                      onClick={() => { copyToGoogleDrive(scan); setActiveMenuId(null); }}
                                      className="w-full px-4 py-2.5 text-left text-sm font-medium text-blue-700 hover:bg-blue-50 flex items-center gap-3"
                                    >
                                      <Cloud size={16} /> Copy to Drive
                                    </button>
                                    <button 
                                      onClick={() => { 
                                        setIsSelectionMode(true); 
                                        setSelectedScanIds([scan.id!]); 
                                        setActiveMenuId(null); 
                                      }}
                                      className="w-full px-4 py-2.5 text-left text-sm font-medium text-zinc-700 hover:bg-zinc-50 flex items-center gap-3"
                                    >
                                      <Plus size={16} /> Combine PDF
                                    </button>
                                    <div className="h-px bg-black/5 my-1" />
                                    <button 
                                      onClick={() => { deleteScan(scan.id!); setActiveMenuId(null); }}
                                      className="w-full px-4 py-2.5 text-left text-sm font-medium text-red-600 hover:bg-red-50 flex items-center gap-3"
                                    >
                                      <Trash2 size={16} /> Delete
                                    </button>
                                  </motion.div>
                                </>
                              )}
                            </AnimatePresence>
                          </div>
                        )}

                        {isSelectionMode && (
                          <div className={cn(
                            "w-5 h-5 rounded-full border-2 flex items-center justify-center transition-colors",
                            selectedScanIds.includes(scan.id!) ? "bg-emerald-500 border-emerald-500 text-white" : "bg-zinc-100 border-zinc-300"
                          )}>
                            {selectedScanIds.includes(scan.id!) && <Check size={12} />}
                          </div>
                        )}
                      </motion.div>
                    ))}
                  </div>
                )}
                  </section>
                </div>

                {/* Selection Action Bar */}
                <AnimatePresence>
                  {isSelectionMode && selectedScanIds.length > 0 && (
                    <motion.div 
                      initial={{ y: 100 }}
                      animate={{ y: 0 }}
                      exit={{ y: 100 }}
                      className="fixed bottom-8 left-1/2 -translate-x-1/2 z-50 bg-zinc-900 text-white px-6 py-4 rounded-3xl shadow-2xl flex items-center gap-6 border border-white/10"
                    >
                      <span className="text-sm font-medium">{selectedScanIds.length} items selected</span>
                      <div className="w-px h-6 bg-white/10" />
                      <button 
                        onClick={downloadSelectedAsPDF}
                        className="flex items-center gap-2 text-emerald-400 font-bold text-sm hover:text-emerald-300 transition-colors"
                      >
                        <Download size={18} />
                        Combine PDF
                      </button>
                      <button 
                        onClick={async () => {
                          if (confirm(`Delete ${selectedScanIds.length} scans?`)) {
                            await Promise.all(selectedScanIds.map(id => db.scans.delete(id)));
                            setScans(scans.filter(s => !selectedScanIds.includes(s.id!)));
                            setSelectedScanIds([]);
                            setIsSelectionMode(false);
                          }
                        }}
                        className="flex items-center gap-2 text-red-400 font-bold text-sm hover:text-red-300 transition-colors"
                      >
                        <Trash2 size={18} />
                        Delete
                      </button>
                    </motion.div>
                  )}
                </AnimatePresence>
              </motion.div>
            )}

          {state === 'capture' && (
            <motion.div 
              key="capture"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-[60] bg-black flex flex-col"
            >
              <div className="p-6 flex items-center justify-between text-white">
                <button 
                  onClick={() => { stopCamera(); setState('home'); }}
                  className="p-2 hover:bg-white/10 rounded-full transition-colors flex items-center gap-2"
                >
                  <ChevronLeft size={24} />
                  <span className="text-xs font-bold uppercase tracking-wider hidden sm:inline">Home</span>
                </button>
                <div className="text-center">
                  <span className="text-sm font-medium uppercase tracking-widest block">Scanner View</span>
                  {idCardSide && (
                    <span className="text-xs text-emerald-400 font-bold uppercase">
                      Scan {idCardSide} side
                    </span>
                  )}
                </div>
                <div className="w-10" />
              </div>
              
              <div className="flex-1 relative overflow-hidden flex items-center justify-center">
                <video 
                  ref={videoRef} 
                  autoPlay 
                  playsInline 
                  className="h-full w-full object-cover"
                />
                {/* Guide Overlay */}
                <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
                  <div className="w-[80%] aspect-[3/4] border-2 border-white/30 rounded-2xl relative">
                    <div className="absolute top-0 left-0 w-8 h-8 border-t-4 border-l-4 border-emerald-500 rounded-tl-lg" />
                    <div className="absolute top-0 right-0 w-8 h-8 border-t-4 border-r-4 border-emerald-500 rounded-tr-lg" />
                    <div className="absolute bottom-0 left-0 w-8 h-8 border-b-4 border-l-4 border-emerald-500 rounded-bl-lg" />
                    <div className="absolute bottom-0 right-0 w-8 h-8 border-b-4 border-r-4 border-emerald-500 rounded-br-lg" />
                  </div>
                </div>
              </div>

              <div className="p-12 flex items-center justify-center gap-12 bg-gradient-to-t from-black to-transparent">
                <button 
                  onClick={() => fileInputRef.current?.click()}
                  className="p-4 text-white/60 hover:text-white transition-colors"
                >
                  <ImageIcon size={28} />
                </button>
                <button 
                  onClick={captureImage}
                  className="w-20 h-20 rounded-full border-4 border-white p-1 flex items-center justify-center hover:scale-105 transition-transform"
                >
                  <div className="w-full h-full bg-white rounded-full" />
                </button>
                <div className="w-16" />
              </div>
              <canvas ref={canvasRef} className="hidden" />
            </motion.div>
          )}

          {state === 'crop' && currentImage && (
            <motion.div 
              key="crop"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-[60] bg-zinc-950 flex flex-col overflow-hidden"
            >
              <div className="px-4 py-2 flex items-center justify-between text-white border-b border-white/10 bg-black/40 backdrop-blur-md shrink-0">
                <div className="flex items-center gap-2">
                  <button 
                    onClick={() => setState('capture')}
                    className="p-1.5 hover:bg-white/10 rounded-full transition-colors flex items-center gap-2"
                  >
                    <ChevronLeft size={20} />
                    <span className="text-[10px] font-bold uppercase tracking-wider hidden sm:inline">Back</span>
                  </button>
                  {batchTotal > 1 && (
                    <button 
                      onClick={() => {
                        if (confirm("Cancel batch processing? All progress will be lost.")) {
                          setUploadQueue([]);
                          setBatchTotal(0);
                          setBatchImages([]);
                          setState('home');
                        }
                      }}
                      className="p-1.5 hover:bg-red-500/20 rounded-full transition-colors flex items-center gap-2 text-red-400"
                    >
                      <X size={18} />
                      <span className="text-[10px] font-bold uppercase tracking-wider hidden sm:inline">Cancel</span>
                    </button>
                  )}
                </div>
                <div className="text-center">
                  <h3 className="text-xs font-semibold">Adjust Perspective</h3>
                  <p className="text-[8px] text-white/40 uppercase tracking-widest">
                    {batchTotal > 1 ? `Page ${batchTotal - uploadQueue.length} of ${batchTotal}` : 'Drag corners to align'}
                  </p>
                </div>
                <button 
                  onClick={processCrop}
                  disabled={isProcessing}
                  className="px-4 py-1.5 bg-emerald-600 rounded-full text-xs font-bold hover:bg-emerald-500 disabled:opacity-50 flex items-center gap-2 shadow-lg shadow-emerald-900/20 transition-all active:scale-95"
                >
                  {isProcessing ? 'Processing...' : (uploadQueue.length > 0 ? 'Crop & Next' : 'Crop & Done')}
                  {!isProcessing && (uploadQueue.length > 0 ? <ChevronRight size={14} /> : <Check size={14} />)}
                </button>
              </div>

              <div className="flex-1 relative bg-zinc-950 flex flex-col min-h-0 overflow-hidden">
                <div className="flex-1 relative flex items-center justify-center p-1 sm:p-2 overflow-hidden">
                  <div className="relative inline-block shadow-2xl max-w-full max-h-full">
                    <img 
                      ref={cropImageRef}
                      id="crop-source"
                      src={currentImage} 
                      alt="To crop" 
                      className="max-w-full max-h-full object-contain select-none block rounded-sm transition-transform duration-300"
                      style={{ transform: `rotate(${rotation}deg)` }}
                    />
                    <div className="absolute inset-0 pointer-events-none">
                      <CropHandles 
                        imageRef={cropImageRef}
                        corners={corners} 
                        onChange={setCorners}
                        onDragStart={(idx, pos) => setMagnifierPos(pos)}
                        onDragEnd={() => setMagnifierPos(null)}
                        onMagnifierUpdate={setMagnifierPos}
                      />
                    </div>

                    {/* Magnifier Preview */}
                    {magnifierPos && (
                      <div 
                        className="absolute w-32 h-32 rounded-full border-4 border-emerald-500 shadow-2xl overflow-hidden pointer-events-none z-50 bg-black"
                        style={{ 
                          left: magnifierPos.displayX, 
                          top: magnifierPos.displayY - 100,
                          transform: 'translateX(-50%)'
                        }}
                      >
                        <div 
                          className="w-full h-full"
                          style={{
                            backgroundImage: `url(${currentImage})`,
                            backgroundSize: `${(document.getElementById('crop-source') as HTMLImageElement).width * 4}px auto`,
                            backgroundPosition: `-${magnifierPos.displayX * 4 - 64}px -${magnifierPos.displayY * 4 - 64}px`,
                            backgroundRepeat: 'no-repeat'
                          }}
                        />
                        <div className="absolute inset-0 flex items-center justify-center">
                          <div className="w-full h-[1px] bg-emerald-500/50" />
                          <div className="absolute h-full w-[1px] bg-emerald-500/50" />
                          <div className="absolute bottom-2 bg-emerald-600 text-[8px] font-bold text-white px-1.5 py-0.5 rounded uppercase tracking-tighter">
                            Zoom
                          </div>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Scanning Animation Overlay */}
                  {isAutoDetecting && (
                    <div className="absolute inset-0 pointer-events-none overflow-hidden">
                      <motion.div 
                        initial={{ top: '-10%' }}
                        animate={{ top: '110%' }}
                        transition={{ duration: 2, repeat: Infinity, ease: "linear" }}
                        className="absolute left-0 right-0 h-1 bg-emerald-400 shadow-[0_0_15px_rgba(52,211,153,0.8)] z-20"
                      />
                      <div className="absolute inset-0 bg-emerald-500/5 animate-pulse" />
                    </div>
                  )}
                </div>
                
                <div className="bg-zinc-900/50 border-t border-white/5 p-3 flex items-center justify-center gap-6 shrink-0">
                  <button 
                    onClick={() => {
                      setCurrentImage(null);
                      startCamera();
                    }}
                    className="flex flex-col items-center gap-1.5 text-white/60 hover:text-red-400 transition-colors"
                  >
                    <div className="w-8 h-8 rounded-full bg-white/5 flex items-center justify-center">
                      <RefreshCw size={16} className="rotate-180" />
                    </div>
                    <span className="text-[8px] font-bold uppercase tracking-widest">Retake</span>
                  </button>

                  <button 
                    onClick={() => {
                      const img = cropImageRef.current;
                      if (img) {
                        setRotation(prev => (prev + 90) % 360);
                        // Reset corners after rotation to match new orientation
                        setTimeout(() => setInitialCorners(img), 100);
                      }
                    }}
                    className="flex flex-col items-center gap-1.5 text-white/60 hover:text-white transition-colors"
                  >
                    <div className="w-8 h-8 rounded-full bg-white/5 flex items-center justify-center">
                      <RefreshCw size={16} />
                    </div>
                    <span className="text-[8px] font-bold uppercase tracking-widest">Rotate</span>
                  </button>

                  <button 
                    onClick={autoDetectCorners}
                    disabled={isAutoDetecting}
                    className="flex flex-col items-center gap-1.5 text-white/60 hover:text-emerald-400 transition-colors disabled:opacity-50"
                  >
                    <div className="w-8 h-8 rounded-full bg-white/5 flex items-center justify-center">
                      <Zap size={16} className={isAutoDetecting ? "animate-pulse" : ""} />
                    </div>
                    <span className="text-[8px] font-bold uppercase tracking-widest">Auto</span>
                  </button>
                  
                  <button 
                    onClick={() => {
                      const img = document.getElementById('crop-source') as HTMLImageElement;
                      if (img) {
                        const w = img.width;
                        const h = img.height;
                        setCorners([
                          { x: w * 0.05, y: h * 0.05 },
                          { x: w * 0.95, y: h * 0.05 },
                          { x: w * 0.95, y: h * 0.95 },
                          { x: w * 0.05, y: h * 0.95 }
                        ]);
                      }
                    }}
                    className="flex flex-col items-center gap-1.5 text-white/60 hover:text-white transition-colors"
                  >
                    <div className="w-8 h-8 rounded-full bg-white/5 flex items-center justify-center">
                      <History size={16} />
                    </div>
                    <span className="text-[8px] font-bold uppercase tracking-widest">Reset</span>
                  </button>
                </div>

                {/* Carousel */}
                {batchTotal > 1 && (
                  <div className="bg-zinc-950 border-t border-white/5 py-3 overflow-x-auto no-scrollbar shrink-0">
                    <div className="flex gap-2 min-w-max mx-auto px-4">
                      {/* Already processed */}
                      {batchImages.map((img, i) => (
                        <div key={`batch-${i}`} className="w-8 h-12 rounded border border-emerald-500/50 overflow-hidden opacity-40 relative">
                          <img src={img} className="w-full h-full object-cover" />
                          <div className="absolute inset-0 bg-emerald-500/20 flex items-center justify-center">
                            <Check size={10} className="text-white" />
                          </div>
                        </div>
                      ))}
                      {/* Current */}
                      <div className="w-8 h-12 rounded border-2 border-emerald-500 overflow-hidden relative ring-2 ring-emerald-500/20">
                        <img src={currentImage} className="w-full h-full object-cover" />
                        <div className="absolute bottom-0 left-0 right-0 bg-emerald-500 text-[6px] font-black text-white text-center py-0.5 uppercase">
                          Crop
                        </div>
                      </div>
                      {/* Remaining */}
                      {uploadQueue.map((img, i) => (
                        <div 
                          key={`queue-${i}`} 
                          onClick={() => {
                            // Swap current with this one
                            const newQueue = [...uploadQueue];
                            const selected = newQueue.splice(i, 1)[0];
                            newQueue.unshift(currentImage);
                            setUploadQueue(newQueue);
                            setCurrentImage(selected);
                            setRotation(0);
                            const tempImg = new Image();
                            tempImg.onload = () => setInitialCorners(tempImg);
                            tempImg.src = selected;
                          }}
                          className="w-8 h-12 rounded border border-white/10 overflow-hidden opacity-40 hover:opacity-100 cursor-pointer transition-opacity"
                        >
                          <img src={img} className="w-full h-full object-cover" />
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </motion.div>
          )}

          {state === 'preview' && processedImage && (
            <motion.div 
              key="preview"
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 1.05 }}
              className="fixed inset-0 z-[60] bg-white flex flex-col overflow-hidden"
            >
              <div className="p-3 flex items-center justify-between border-b border-black/5 bg-white/80 backdrop-blur-md shrink-0">
                <div className="flex items-center gap-2">
                  <button 
                    onClick={() => setState('home')}
                    className="p-1.5 hover:bg-zinc-100 rounded-full transition-colors flex items-center gap-2"
                  >
                    <ChevronLeft size={20} />
                    <span className="text-[10px] font-bold uppercase tracking-wider hidden sm:inline">Home</span>
                  </button>
                  {batchTotal > 1 && (
                    <button 
                      onClick={() => {
                        if (confirm("Cancel batch processing? All progress will be lost.")) {
                          setUploadQueue([]);
                          setBatchTotal(0);
                          setBatchImages([]);
                          setState('home');
                        }
                      }}
                      className="p-1.5 hover:bg-red-50 rounded-full transition-colors flex items-center gap-2 text-red-500"
                    >
                      <X size={18} />
                      <span className="text-[10px] font-bold uppercase tracking-wider hidden sm:inline">Cancel</span>
                    </button>
                  )}
                </div>
                <div className="text-center">
                  <h3 className="text-xs font-semibold">Final Result</h3>
                  <p className="text-[8px] text-zinc-400 uppercase tracking-widest">Review and save</p>
                </div>
                <button 
                  onClick={saveScan}
                  className="px-4 py-1.5 bg-emerald-600 text-white rounded-full text-xs font-semibold hover:bg-emerald-700 transition-colors shadow-lg shadow-emerald-900/10 active:scale-95"
                >
                  {uploadQueue.length > 0 ? 'Next Page' : 'Save to Library'}
                </button>
              </div>

              <div className="flex-1 bg-zinc-100 p-1 sm:p-2 overflow-hidden flex items-center justify-center">
                <div className="bg-white shadow-2xl rounded-sm p-0.5 md:p-1 max-w-full max-h-full flex items-center justify-center overflow-hidden">
                  <img 
                    src={processedImage} 
                    alt="Processed" 
                    className="max-w-full max-h-full object-contain border border-zinc-200"
                  />
                </div>
              </div>

              <div className="p-3 sm:p-4 border-t border-black/5 flex justify-center gap-4 sm:gap-8 bg-white shrink-0">
                <button 
                  onClick={rotateProcessedImage}
                  className="flex flex-col items-center gap-1.5 text-zinc-400 hover:text-emerald-600 transition-colors"
                >
                  <div className="w-8 h-8 sm:w-10 sm:h-10 rounded-xl bg-zinc-50 border border-zinc-200 flex items-center justify-center">
                    <RefreshCw size={18} />
                  </div>
                  <span className="text-[8px] font-bold uppercase tracking-wider">Rotate</span>
                </button>
                <button 
                  onClick={() => applyFilter('enhance')}
                  className="flex flex-col items-center gap-1.5 text-zinc-400 hover:text-emerald-600 transition-colors"
                >
                  <div className="w-8 h-8 sm:w-10 sm:h-10 rounded-xl bg-zinc-50 border border-zinc-200 flex items-center justify-center">
                    <Zap size={18} />
                  </div>
                  <span className="text-[8px] font-bold uppercase tracking-wider">Enhance</span>
                </button>
                <button 
                  onClick={() => applyFilter('bw')}
                  className="flex flex-col items-center gap-1.5 text-zinc-400 hover:text-emerald-600 transition-colors"
                >
                  <div className="w-8 h-8 sm:w-10 sm:h-10 rounded-xl bg-zinc-50 border border-zinc-200 flex items-center justify-center">
                    <ImageIcon size={18} />
                  </div>
                  <span className="text-[8px] font-bold uppercase tracking-wider">B&W</span>
                </button>
              </div>

              {/* Carousel in Preview */}
              {batchTotal > 1 && (
                <div className="bg-zinc-50 border-t border-black/5 py-3 overflow-x-auto no-scrollbar shrink-0">
                  <div className="flex gap-2 min-w-max mx-auto px-4">
                    {batchImages.map((img, i) => (
                      <div 
                        key={`batch-${i}`} 
                        onClick={() => {
                          setProcessedImage(img);
                        }}
                        className={cn(
                          "w-8 h-12 rounded border overflow-hidden relative cursor-pointer transition-all",
                          processedImage === img ? "border-emerald-500 ring-2 ring-emerald-500/20 scale-110 z-10" : "border-emerald-500/50 opacity-40 hover:opacity-80"
                        )}
                      >
                        <img src={img} className="w-full h-full object-cover" />
                        <div className="absolute inset-0 bg-emerald-500/10 flex items-center justify-center">
                          <Check size={10} className="text-white" />
                        </div>
                      </div>
                    ))}
                    <div 
                      onClick={() => {
                        // Current one
                      }}
                      className={cn(
                        "w-8 h-12 rounded border overflow-hidden relative transition-all",
                        !batchImages.includes(processedImage) ? "border-2 border-emerald-500 ring-2 ring-emerald-500/20 scale-110 z-10" : "border-black/10 opacity-20"
                      )}
                    >
                      <img src={processedImage} className="w-full h-full object-cover" />
                      <div className="absolute bottom-0 left-0 right-0 bg-emerald-500 text-[6px] font-black text-white text-center py-0.5 uppercase">
                        Preview
                      </div>
                    </div>
                    {uploadQueue.map((img, i) => (
                      <div 
                        key={`queue-${i}`} 
                        onClick={() => {
                          const newQueue = [...uploadQueue];
                          const selected = newQueue.splice(i, 1)[0];
                          newQueue.unshift(currentImage);
                          setUploadQueue(newQueue);
                          setCurrentImage(selected);
                          setRotation(0);
                          const tempImg = new Image();
                          tempImg.onload = () => {
                            setInitialCorners(tempImg);
                            setState('crop');
                          };
                          tempImg.src = selected;
                        }}
                        className="w-8 h-12 rounded border border-black/10 overflow-hidden opacity-20 hover:opacity-100 cursor-pointer transition-opacity"
                      >
                        <img src={img} className="w-full h-full object-cover" />
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </motion.div>
          )}

          {state === 'batch' && batchImages.length > 0 && (
            <motion.div 
              key="batch"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-[60] bg-[#F5F5F5] flex flex-col"
            >
              <div className="px-6 py-4 flex items-center justify-between bg-white border-b border-black/5">
                <button 
                  onClick={() => setState('home')}
                  className="p-2 hover:bg-zinc-100 rounded-full transition-colors flex items-center gap-2"
                >
                  <ChevronLeft size={24} />
                  <span className="text-xs font-bold uppercase tracking-wider hidden sm:inline">Home</span>
                </button>
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 bg-emerald-600 rounded-lg flex items-center justify-center text-white">
                    <FileText size={18} />
                  </div>
                  <h3 className="font-bold">Batch Session ({batchImages.length} pages)</h3>
                </div>
                <button 
                  onClick={finishBatch}
                  className="px-6 py-2 bg-emerald-600 text-white rounded-full text-sm font-bold hover:bg-emerald-700 shadow-lg shadow-emerald-900/20 transition-all active:scale-95"
                >
                  Finish & Save
                </button>
              </div>

              <div className="flex-1 overflow-auto p-8">
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-6 max-w-6xl mx-auto">
                  {batchImages.map((img, idx) => (
                    <div key={idx} className="relative group aspect-[3/4] bg-white rounded-2xl overflow-hidden shadow-md border border-black/5 hover:shadow-xl transition-all">
                      <img src={img} alt={`Page ${idx + 1}`} className="w-full h-full object-cover" />
                      <div className="absolute top-3 left-3 bg-black/50 text-white text-[10px] font-bold px-2 py-0.5 rounded-full backdrop-blur-md uppercase tracking-wider">
                        Page {idx + 1}
                      </div>
                      <button 
                        onClick={() => setBatchImages(prev => prev.filter((_, i) => i !== idx))}
                        className="absolute top-3 right-3 w-8 h-8 bg-red-500 text-white rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all hover:scale-110 shadow-lg"
                      >
                        <X size={16} />
                      </button>
                    </div>
                  ))}
                  
                  <button 
                    onClick={() => setState('home')}
                    className="aspect-[3/4] border-2 border-dashed border-zinc-300 rounded-2xl flex flex-col items-center justify-center gap-3 text-zinc-400 hover:border-emerald-500 hover:text-emerald-500 hover:bg-emerald-50 transition-all group"
                  >
                    <div className="w-12 h-12 rounded-full bg-zinc-50 flex items-center justify-center group-hover:bg-emerald-100 transition-colors">
                      <Plus size={24} />
                    </div>
                    <span className="text-[10px] font-bold uppercase tracking-widest">Add Page</span>
                  </button>
                </div>
              </div>
            </motion.div>
          )}
          {state === 'ocr' && (
            <motion.div 
              key="ocr"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="fixed inset-0 z-[70] bg-white flex flex-col"
            >
              <div className="px-6 py-4 flex items-center justify-between border-b border-black/5">
                <div className="flex items-center gap-3">
                  <button onClick={() => setState('home')} className="p-2 hover:bg-zinc-100 rounded-full transition-colors flex items-center gap-2">
                    <ChevronLeft size={24} />
                    <span className="text-xs font-bold uppercase tracking-wider hidden sm:inline">Home</span>
                  </button>
                  <h3 className="font-bold">Extracted Text</h3>
                </div>
                <button 
                  onClick={() => {
                    navigator.clipboard.writeText(extractedText || "");
                    alert("Copied to clipboard!");
                  }}
                  className="px-4 py-2 bg-emerald-50 text-emerald-700 rounded-full text-sm font-bold hover:bg-emerald-100 transition-colors"
                >
                  Copy All
                </button>
              </div>
              
              <div className="flex-1 overflow-auto p-8 bg-zinc-50">
                {isExtracting ? (
                  <div className="h-full flex flex-col items-center justify-center gap-4 text-zinc-400">
                    <div className="w-12 h-12 border-4 border-emerald-500/20 border-t-emerald-500 rounded-full animate-spin" />
                    <p className="text-sm font-medium animate-pulse">Gemini is reading your document...</p>
                  </div>
                ) : (
                  <div className="max-w-2xl mx-auto bg-white p-8 rounded-2xl shadow-sm border border-black/5 min-h-full">
                    <pre className="whitespace-pre-wrap font-sans text-zinc-800 leading-relaxed">
                      {extractedText}
                    </pre>
                  </div>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* View Modal */}
        <AnimatePresence>
          {viewingScan && (
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-[100] bg-black/90 backdrop-blur-sm flex flex-col"
            >
              <div className="p-6 flex items-center justify-between text-white">
                <button onClick={() => setViewingScan(null)} className="p-2 hover:bg-white/10 rounded-full transition-colors">
                  <X size={24} />
                </button>
                <div className="text-center">
                  <h3 className="text-sm font-semibold">{viewingScan.name}</h3>
                  <p className="text-[10px] text-white/40 uppercase tracking-widest">Full View</p>
                </div>
                <div className="flex items-center gap-2">
                  <button 
                    onClick={() => downloadPDF(viewingScan)}
                    className="p-2 hover:bg-white/10 rounded-full transition-colors"
                  >
                    <Download size={20} />
                  </button>
                </div>
              </div>
              <div className="flex-1 overflow-auto p-4 flex items-center justify-center">
                <img 
                  src={viewingScan.processedImage} 
                  alt={viewingScan.name} 
                  className="max-w-full max-h-full object-contain shadow-2xl"
                />
              </div>
              <div className="p-8 flex justify-center gap-6">
                <button 
                  onClick={() => { editScan(viewingScan); setViewingScan(null); }}
                  className="px-6 py-2 bg-white text-black rounded-full text-sm font-bold hover:bg-zinc-200 transition-colors"
                >
                  Modify
                </button>
                <button 
                  onClick={() => { extractText(viewingScan.processedImage); setViewingScan(null); }}
                  className="px-6 py-2 bg-emerald-600 text-white rounded-full text-sm font-bold hover:bg-emerald-700 transition-colors"
                >
                  Extract Text
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </main>
  </div>
);
}

function CropHandles({ imageRef, corners, onChange, onDragStart, onDragEnd, onMagnifierUpdate }: { 
  imageRef: React.RefObject<HTMLImageElement | null>,
  corners: Point[], 
  onChange: (c: Point[]) => void,
  onDragStart?: (idx: number, pos: Point & { displayX: number, displayY: number }) => void,
  onDragEnd?: () => void,
  onMagnifierUpdate?: (pos: Point & { displayX: number, displayY: number }) => void
}) {
  const [draggingIdx, setDraggingIdx] = useState<number | null>(null);
  const [imgSize, setImgSize] = useState({ width: 0, height: 0, naturalWidth: 1, naturalHeight: 1 });

  const updateSize = useCallback(() => {
    const img = imageRef.current;
    if (img && img.complete) {
      const rect = img.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        setImgSize({
          width: rect.width,
          height: rect.height,
          naturalWidth: img.naturalWidth || 1,
          naturalHeight: img.naturalHeight || 1
        });
      }
    }
  }, [imageRef]);

  useEffect(() => {
    const img = imageRef.current;
    if (!img) return;

    updateSize();
    img.addEventListener('load', updateSize);
    window.addEventListener('resize', updateSize);
    
    const observer = new ResizeObserver(updateSize);
    observer.observe(img);

    return () => {
      img.removeEventListener('load', updateSize);
      window.removeEventListener('resize', updateSize);
      observer.disconnect();
    };
  }, [updateSize, imageRef]);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (draggingIdx === null) return;
      
      const img = imageRef.current;
      if (!img) return;

      const rect = img.getBoundingClientRect();
      const scaleX = img.naturalWidth / rect.width;
      const scaleY = img.naturalHeight / rect.height;

      const x = (e.clientX - rect.left) * scaleX;
      const y = (e.clientY - rect.top) * scaleY;

      const clampedX = Math.max(0, Math.min(img.naturalWidth, x));
      const clampedY = Math.max(0, Math.min(img.naturalHeight, y));

      const newCorners = [...corners];
      newCorners[draggingIdx] = { x: clampedX, y: clampedY };
      onChange(newCorners);

      const pos = { 
        x: clampedX, 
        y: clampedY, 
        displayX: (clampedX / img.naturalWidth) * rect.width,
        displayY: (clampedY / img.naturalHeight) * rect.height
      };

      if (onMagnifierUpdate) {
        onMagnifierUpdate(pos);
      }
    };

    const handleTouchMove = (e: TouchEvent) => {
      if (draggingIdx === null) return;
      const touch = e.touches[0];
      const img = imageRef.current;
      if (!img) return;

      const rect = img.getBoundingClientRect();
      const scaleX = img.naturalWidth / rect.width;
      const scaleY = img.naturalHeight / rect.height;

      const x = (touch.clientX - rect.left) * scaleX;
      const y = (touch.clientY - rect.top) * scaleY;

      const clampedX = Math.max(0, Math.min(img.naturalWidth, x));
      const clampedY = Math.max(0, Math.min(img.naturalHeight, y));

      const newCorners = [...corners];
      newCorners[draggingIdx] = { x: clampedX, y: clampedY };
      onChange(newCorners);

      const pos = { 
        x: clampedX, 
        y: clampedY, 
        displayX: (clampedX / img.naturalWidth) * rect.width,
        displayY: (clampedY / img.naturalHeight) * rect.height
      };

      if (onMagnifierUpdate) {
        onMagnifierUpdate(pos);
      }
    };

    const handleMouseUp = () => {
      setDraggingIdx(null);
      if (onDragEnd) onDragEnd();
    };

    if (draggingIdx !== null) {
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
      window.addEventListener('touchmove', handleTouchMove, { passive: false });
      window.addEventListener('touchend', handleMouseUp);
    }

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
      window.removeEventListener('touchmove', handleTouchMove);
      window.removeEventListener('touchend', handleMouseUp);
    };
  }, [draggingIdx, corners, onChange, onMagnifierUpdate, imageRef]);

  const scaleX = imgSize.width / imgSize.naturalWidth;
  const scaleY = imgSize.height / imgSize.naturalHeight;
  const displayCorners = corners.map(p => ({
    x: p.x * scaleX,
    y: p.y * scaleY
  }));

  if (imgSize.width === 0) return null;

  return (
    <div className="absolute inset-0 pointer-events-none">
      {/* Connector Lines */}
      <svg className="absolute inset-0 w-full h-full pointer-events-none overflow-visible">
        <path 
          d={`M ${displayCorners[0].x} ${displayCorners[0].y} 
             L ${displayCorners[1].x} ${displayCorners[1].y} 
             L ${displayCorners[2].x} ${displayCorners[2].y} 
             L ${displayCorners[3].x} ${displayCorners[3].y} Z`}
          fill="rgba(16, 185, 129, 0.25)"
          stroke="#10b981"
          strokeWidth="3"
          strokeDasharray="4 2"
        />
      </svg>

      {/* Draggable Handles */}
      {displayCorners.map((p, i) => (
        <div 
          key={i}
          onMouseDown={(e) => {
            e.preventDefault();
            setDraggingIdx(i);
            if (onDragStart) {
              const img = imageRef.current;
              if (img) {
                const rect = img.getBoundingClientRect();
                onDragStart(i, { 
                  x: corners[i].x, 
                  y: corners[i].y,
                  displayX: p.x,
                  displayY: p.y
                });
              }
            }
          }}
          onTouchStart={(e) => {
            setDraggingIdx(i);
            if (onDragStart) {
              const img = imageRef.current;
              if (img) {
                onDragStart(i, { 
                  x: corners[i].x, 
                  y: corners[i].y,
                  displayX: p.x,
                  displayY: p.y
                });
              }
            }
          }}
          className="absolute w-12 h-12 -ml-6 -mt-6 pointer-events-auto cursor-move flex items-center justify-center group z-10"
          style={{ left: p.x, top: p.y }}
        >
          <div className="w-6 h-6 bg-white border-2 border-emerald-500 rounded-full shadow-xl group-hover:scale-125 transition-transform flex items-center justify-center">
            <div className="w-2 h-2 bg-emerald-500 rounded-full" />
          </div>
        </div>
      ))}
    </div>
  );
}
