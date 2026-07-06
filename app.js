const STORAGE_KEY = "bright-instant-desk-v1";
const PHOTO_RATIO = 1;
const FILTER_VERSION = 4;

const tabletop = document.querySelector("#tabletop");
const fileInput = document.querySelector("#fileInput");
const uploadButton = document.querySelector("#uploadButton");
const dockUpload = document.querySelector("#dockUpload");
const clearButton = document.querySelector("#clearButton");
const saveButton = document.querySelector("#saveButton");
const emptyHint = document.querySelector("#emptyHint");
const slot = document.querySelector(".slot");
const ejectAudio = new Audio("./assets/polaroid-taking-picture-cc0.mp3");
const lightbox = document.querySelector("#lightbox");
const lightboxPhoto = document.querySelector("#lightboxPhoto");
const closeLightbox = document.querySelector("#closeLightbox");
const lightboxSave = document.querySelector("#lightboxSave");

let photos = loadPhotos();
let selectedId = null;
let zCounter = photos.length + 8;
const DEVELOP_MS = 35000;

ejectAudio.preload = "auto";

renderAll();

uploadButton.addEventListener("click", () => {
  primeAudio();
  openPicker();
});
dockUpload.addEventListener("click", () => {
  primeAudio();
  openPicker();
});
clearButton.addEventListener("click", () => {
  photos = [];
  selectedId = null;
  savePhotos();
  renderAll();
});
saveButton.addEventListener("click", () => saveSelectedPhoto());
closeLightbox.addEventListener("click", closePreview);
lightbox.addEventListener("click", (event) => {
  if (event.target === lightbox) closePreview();
});
lightboxSave.addEventListener("click", () => saveSelectedPhoto());

fileInput.addEventListener("change", (event) => {
  primeAudio();
  const [file] = event.target.files || [];
  if (file) addPhoto(file);
  fileInput.value = "";
});

tabletop.addEventListener("dragover", (event) => {
  event.preventDefault();
  tabletop.classList.add("drag-over");
});

tabletop.addEventListener("dragleave", () => {
  tabletop.classList.remove("drag-over");
});

tabletop.addEventListener("drop", (event) => {
  event.preventDefault();
  primeAudio();
  tabletop.classList.remove("drag-over");
  const [file] = [...event.dataTransfer.files].filter((item) => item.type.startsWith("image/"));
  if (file) addPhoto(file);
});

function openPicker() {
  fileInput.click();
}

async function addPhoto(file) {
  const imageUrl = await cropAndFilterToInstantSquare(file);
  const size = getPaperSize();
  const target = nextLanding(size);
  const photo = {
    id: crypto.randomUUID(),
    imageUrl,
    x: target.x,
    y: target.y,
    r: target.r,
    z: ++zCounter,
    developed: false,
    ejecting: true,
    filterVersion: FILTER_VERSION,
    createdAt: Date.now()
  };

  photos.push(photo);
  selectedId = photo.id;
  savePhotos();
  renderAll();
  launchEjectOverlay(photo);

  window.setTimeout(() => {
    photo.developed = true;
    savePhotos();
    const el = document.querySelector(`[data-id="${photo.id}"]`);
    if (el) el.classList.remove("developing");
  }, DEVELOP_MS);
}

function renderAll() {
  tabletop.querySelectorAll(".polaroid").forEach((item) => item.remove());
  emptyHint.hidden = photos.length > 0;

  photos.forEach((photo) => {
    const card = document.createElement("article");
    card.className = "polaroid";
    if (photo.id === selectedId) card.classList.add("selected");
    if (!photo.developed) card.classList.add("developing");
    if (photo.ejecting) card.classList.add("pending-eject");
    card.dataset.id = photo.id;
    card.setAttribute("aria-label", "双击放大这张即时相纸");
    card.style.setProperty("--x", `${photo.x}px`);
    card.style.setProperty("--y", `${photo.y}px`);
    card.style.setProperty("--r", `${photo.r}deg`);
    card.style.zIndex = photo.z;

    const windowEl = document.createElement("div");
    windowEl.className = "photo-window";

    const img = document.createElement("img");
    img.alt = "生成的即时相纸照片";
    img.draggable = false;
    img.src = photo.imageUrl;

    windowEl.append(img);
    card.append(windowEl);
    tabletop.append(card);

    bindDrag(card, photo);
  });
}

function bindDrag(card, photo) {
  let startX = 0;
  let startY = 0;
  let baseX = 0;
  let baseY = 0;
  let isDragging = false;
  let lastTapAt = 0;

  card.addEventListener("pointerdown", (event) => {
    selectedId = photo.id;
    photo.z = ++zCounter;
    card.style.zIndex = photo.z;
    document.querySelectorAll(".polaroid").forEach((item) => item.classList.remove("selected"));
    card.classList.add("selected");

    startX = event.clientX;
    startY = event.clientY;
    baseX = photo.x;
    baseY = photo.y;
    isDragging = false;
    card.setPointerCapture(event.pointerId);
  });

  card.addEventListener("pointermove", (event) => {
    const dx = event.clientX - startX;
    const dy = event.clientY - startY;
    if (!isDragging && Math.hypot(dx, dy) < 7) return;
    if (!isDragging) {
      isDragging = true;
      card.classList.add("dragging");
    }
    const size = getPaperSize();
    photo.x = clamp(baseX + dx, -size.w * 0.38, window.innerWidth - size.w * 0.62);
    photo.y = clamp(baseY + dy, 96, window.innerHeight - size.h * 0.54);
    card.style.setProperty("--x", `${photo.x}px`);
    card.style.setProperty("--y", `${photo.y}px`);
  });

  card.addEventListener("pointerup", (event) => {
    card.classList.remove("dragging");
    if (card.hasPointerCapture(event.pointerId)) card.releasePointerCapture(event.pointerId);
    if (isDragging) {
      savePhotos();
      return;
    }

    const now = Date.now();
    if (now - lastTapAt < 340) {
      lastTapAt = 0;
      openPreview(photo.id);
    } else {
      lastTapAt = now;
    }
  });

  card.addEventListener("pointercancel", (event) => {
    isDragging = false;
    card.classList.remove("dragging");
    if (card.hasPointerCapture(event.pointerId)) card.releasePointerCapture(event.pointerId);
  });
}

function launchEjectOverlay(photo) {
  playEjectSound();
  const overlay = createEjectOverlay(photo);
  setEjectMotion(overlay, photo);
  document.body.append(overlay);
  overlay.addEventListener("animationend", (event) => {
    if (event.target !== overlay) return;
    overlay.remove();
    photo.ejecting = false;
    savePhotos();
    renderAll();
  }, { once: true });
}

function createEjectOverlay(photo) {
  const overlay = document.createElement("div");
  overlay.className = "eject-overlay";
  const card = document.createElement("article");
  card.className = "polaroid eject-overlay-paper developing";
  const windowEl = document.createElement("div");
  windowEl.className = "photo-window";
  const img = document.createElement("img");
  img.alt = "正在吐出的即时相纸照片";
  img.draggable = false;
  img.src = photo.imageUrl;
  windowEl.append(img);
  card.append(windowEl);
  overlay.append(card);
  return overlay;
}

function cropAndFilterToInstantSquare(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = reject;
    reader.onload = () => {
      const img = new Image();
      img.onerror = reject;
      img.onload = () => {
        const canvas = document.createElement("canvas");
        canvas.width = 1200;
        canvas.height = Math.round(1200 / PHOTO_RATIO);
        const ctx = canvas.getContext("2d", { willReadFrequently: true });

        const sourceRatio = img.width / img.height;
        let sx = 0;
        let sy = 0;
        let sw = img.width;
        let sh = img.height;

        if (sourceRatio > PHOTO_RATIO) {
          sw = img.height * PHOTO_RATIO;
          sx = (img.width - sw) / 2;
        } else {
          sh = img.width / PHOTO_RATIO;
          sy = (img.height - sh) / 2;
        }

        ctx.drawImage(img, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
        softenInstantImage(ctx, canvas.width, canvas.height);
        applyColor600Look(ctx, canvas.width, canvas.height);
        resolve(canvas.toDataURL("image/jpeg", 0.9));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

function applyColor600Look(ctx, width, height) {
  const image = ctx.getImageData(0, 0, width, height);
  const data = image.data;
  const cx = width / 2;
  const cy = height / 2;
  const maxDistance = Math.hypot(cx, cy);

  for (let index = 0; index < data.length; index += 4) {
    const x = (index / 4) % width;
    const y = Math.floor(index / 4 / width);
    let r = data[index];
    let g = data[index + 1];
    let b = data[index + 2];

    r = curve600(r);
    g = curve600(g);
    b = curve600(b);

    const luminance = 0.299 * r + 0.587 * g + 0.114 * b;
    const shadow = 1 - luminance / 255;
    const highlight = luminance / 255;
    const compressed = 124 + (luminance - 124) * 0.62;

    r = r * 0.52 + compressed * 0.48 + 8 * highlight + 5;
    g = g * 0.5 + compressed * 0.5 + 5 * shadow + 1;
    b = b * 0.48 + compressed * 0.52 - 5 * highlight - 3 * shadow;

    const muted = 0.299 * r + 0.587 * g + 0.114 * b;
    r = muted + (r - muted) * 0.82;
    g = muted + (g - muted) * 0.8;
    b = muted + (b - muted) * 0.74;

    const distance = Math.hypot(x - cx, y - cy) / maxDistance;
    const vignette = 1 - Math.max(0, distance - 0.34) * 0.34;
    const grain = (Math.random() - 0.5) * 14;
    const wash = filmWashColor(x / width, y / height);

    r = r * vignette + grain;
    g = g * vignette + grain * 0.7;
    b = b * vignette + grain * 0.45;

    data[index] = clampColor(r * (1 - wash.alpha) + wash.r * wash.alpha + 1.5);
    data[index + 1] = clampColor(g * (1 - wash.alpha) + wash.g * wash.alpha + 1);
    data[index + 2] = clampColor(b * (1 - wash.alpha) + wash.b * wash.alpha + 0.5);
  }

  ctx.putImageData(image, 0, 0);
}

function filmWashColor(nx, ny) {
  const t = Math.max(0, Math.min(1, nx * 0.42 + ny * 0.58));
  const first = { r: 250, g: 235, b: 203 };
  const middle = { r: 92, g: 122, b: 98 };
  const last = { r: 188, g: 112, b: 76 };
  const color = t < 0.52
    ? mixColor(first, middle, t / 0.52)
    : mixColor(middle, last, (t - 0.52) / 0.48);

  return {
    ...color,
    alpha: 0.034 + Math.abs(t - 0.5) * 0.038
  };
}

function mixColor(from, to, amount) {
  return {
    r: from.r + (to.r - from.r) * amount,
    g: from.g + (to.g - from.g) * amount,
    b: from.b + (to.b - from.b) * amount
  };
}

function curve600(value) {
  const normalized = value / 255;
  const liftedBlack = Math.pow(normalized, 0.92);
  const shoulder = 1 - Math.pow(1 - liftedBlack, 0.78);
  return clampColor(shoulder * 255);
}

function softenInstantImage(ctx, width, height) {
  const temp = document.createElement("canvas");
  temp.width = Math.round(width * 0.38);
  temp.height = Math.round(height * 0.38);
  const tempCtx = temp.getContext("2d");
  tempCtx.imageSmoothingEnabled = true;
  tempCtx.imageSmoothingQuality = "medium";
  tempCtx.drawImage(ctx.canvas, 0, 0, temp.width, temp.height);

  ctx.clearRect(0, 0, width, height);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "medium";
  ctx.drawImage(temp, 0, 0, width, height);
}

function clampColor(value) {
  return Math.max(0, Math.min(255, Math.round(value)));
}

function openPreview(id) {
  selectedId = id;
  const photo = photos.find((item) => item.id === id);
  if (!photo) return;
  lightboxPhoto.innerHTML = "";
  lightboxPhoto.append(createPreviewCard(photo));
  lightbox.hidden = false;
}

function closePreview() {
  lightbox.hidden = true;
  lightboxPhoto.innerHTML = "";
}

function createPreviewCard(photo) {
  const card = document.createElement("article");
  card.className = "polaroid preview-polaroid";
  const windowEl = document.createElement("div");
  windowEl.className = "photo-window";
  const img = document.createElement("img");
  img.alt = "放大的即时相纸照片";
  img.draggable = false;
  img.src = photo.imageUrl;
  windowEl.append(img);
  card.append(windowEl);
  return card;
}

async function saveSelectedPhoto() {
  const photo = photos.find((item) => item.id === selectedId) || photos.at(-1);
  if (!photo) return;
  const dataUrl = await renderPhotoForSave(photo);
  const link = document.createElement("a");
  link.href = dataUrl;
  link.download = `instant-photo-${new Date(photo.createdAt).toISOString().slice(0, 10)}.png`;
  link.click();
}

function renderPhotoForSave(photo) {
  return new Promise((resolve, reject) => {
    const canvas = document.createElement("canvas");
    canvas.width = 980;
    canvas.height = 1190;
    const ctx = canvas.getContext("2d");

    drawExportPaperBase(ctx, canvas.width, canvas.height);

    const img = new Image();
    img.onerror = reject;
    img.onload = () => {
      const photoCanvas = document.createElement("canvas");
      photoCanvas.width = 840;
      photoCanvas.height = 840;
      const photoCtx = photoCanvas.getContext("2d", { willReadFrequently: true });
      photoCtx.drawImage(img, 0, 0, photoCanvas.width, photoCanvas.height);
      applyDisplayPhotoFinish(photoCtx, photoCanvas.width, photoCanvas.height);

      ctx.save();
      roundRect(ctx, 70, 70, 840, 840, 4);
      ctx.clip();
      ctx.drawImage(photoCanvas, 70, 70, 840, 840);
      ctx.restore();

      drawExportPaperTexture(ctx, canvas.width, canvas.height);

      resolve(canvas.toDataURL("image/png"));
    };
    img.src = photo.imageUrl;
  });
}

function applyDisplayPhotoFinish(ctx, width, height) {
  const image = ctx.getImageData(0, 0, width, height);
  const data = image.data;

  for (let index = 0; index < data.length; index += 4) {
    let r = data[index];
    let g = data[index + 1];
    let b = data[index + 2];

    const gray = 0.299 * r + 0.587 * g + 0.114 * b;
    r = gray + (r - gray) * 1.5;
    g = gray + (g - gray) * 1.48;
    b = gray + (b - gray) * 1.46;

    const sepiaR = r * 0.393 + g * 0.769 + b * 0.189;
    const sepiaG = r * 0.349 + g * 0.686 + b * 0.168;
    const sepiaB = r * 0.272 + g * 0.534 + b * 0.131;

    r = r * 0.91 + sepiaR * 0.09;
    g = g * 0.91 + sepiaG * 0.09;
    b = b * 0.91 + sepiaB * 0.09;

    const luminance = 0.299 * r + 0.587 * g + 0.114 * b;
    const shadow = 1 - luminance / 255;
    const highlight = luminance / 255;
    r += 6 * highlight - 2 * shadow;
    g += 4 * shadow + 2 * highlight;
    b += 4 * shadow - 2 * highlight;

    data[index] = clampColor((r * 1.11 - 128) * 1.08 + 128);
    data[index + 1] = clampColor((g * 1.11 - 128) * 1.08 + 128);
    data[index + 2] = clampColor((b * 1.11 - 128) * 1.08 + 128);
  }

  ctx.putImageData(image, 0, 0);
}

function drawExportPaperBase(ctx, width, height) {
  ctx.save();
  roundRect(ctx, 0, 0, width, height, 24);
  ctx.clip();

  const base = ctx.createLinearGradient(0, 0, 0, height);
  base.addColorStop(0, "#ffffff");
  base.addColorStop(0.58, "#fcfefe");
  base.addColorStop(1, "#f5f8f8");
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, width, height);

  const edgeShade = ctx.createRadialGradient(width * 0.18, height * 0.82, 0, width * 0.18, height * 0.82, width * 0.42);
  edgeShade.addColorStop(0, "rgba(218, 226, 228, 0.18)");
  edgeShade.addColorStop(1, "rgba(218, 226, 228, 0)");
  ctx.fillStyle = edgeShade;
  ctx.fillRect(0, 0, width, height);

  ctx.restore();
}

function drawExportPaperTexture(ctx, width, height) {
  ctx.save();
  roundRect(ctx, 0, 0, width, height, 24);
  ctx.rect(70, 70, 840, 840);
  ctx.clip("evenodd");

  ctx.globalAlpha = 0.4;
  ctx.strokeStyle = "rgba(96, 103, 105, 0.08)";
  ctx.lineWidth = 1;
  for (let y = 12; y < height; y += 9) {
    ctx.beginPath();
    ctx.moveTo(0, y + Math.sin(y * 0.03) * 1.5);
    ctx.lineTo(width, y + Math.cos(y * 0.025) * 1.5);
    ctx.stroke();
  }

  ctx.globalAlpha = 0.26;
  ctx.strokeStyle = "rgba(255, 255, 255, 0.52)";
  for (let x = 8; x < width; x += 13) {
    ctx.beginPath();
    ctx.moveTo(x + Math.sin(x * 0.04), 0);
    ctx.lineTo(x + Math.cos(x * 0.03), height);
    ctx.stroke();
  }

  ctx.globalAlpha = 0.28;
  ctx.strokeStyle = "rgba(84, 96, 100, 0.045)";
  for (let i = -height; i < width; i += 22) {
    ctx.beginPath();
    ctx.moveTo(i, height);
    ctx.lineTo(i + height, 0);
    ctx.stroke();
  }

  const gloss = ctx.createLinearGradient(0, 0, width, height);
  gloss.addColorStop(0, "rgba(255,255,255,0.34)");
  gloss.addColorStop(0.34, "rgba(255,255,255,0.04)");
  gloss.addColorStop(1, "rgba(210,214,214,0.08)");
  ctx.globalAlpha = 1;
  ctx.fillStyle = gloss;
  ctx.fillRect(0, 0, width, height);

  const bottomPress = ctx.createRadialGradient(width / 2, height * 0.88, 0, width / 2, height * 0.88, width * 0.36);
  bottomPress.addColorStop(0, "rgba(207, 216, 218, 0.15)");
  bottomPress.addColorStop(1, "rgba(207, 216, 218, 0)");
  ctx.fillStyle = bottomPress;
  ctx.fillRect(0, 0, width, height);

  ctx.restore();

  ctx.save();
  roundRect(ctx, 0, 0, width, height, 24);
  ctx.strokeStyle = "rgba(108, 116, 118, 0.2)";
  ctx.lineWidth = 3;
  ctx.stroke();
  ctx.restore();
}

function roundRect(ctx, x, y, width, height, radius) {
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + width, y, x + width, y + height, radius);
  ctx.arcTo(x + width, y + height, x, y + height, radius);
  ctx.arcTo(x, y + height, x, y, radius);
  ctx.arcTo(x, y, x + width, y, radius);
  ctx.closePath();
}

function nextLanding(size) {
  const centerX = window.innerWidth / 2 - size.w / 2;
  const centerY = Math.max(250, window.innerHeight * 0.38);
  const spreadX = Math.min(260, window.innerWidth * 0.28);
  const spreadY = Math.min(180, window.innerHeight * 0.22);
  const index = photos.length;

  return {
    x: clamp(centerX + random(-spreadX, spreadX) + Math.sin(index * 1.9) * 48, 8, window.innerWidth - size.w - 8),
    y: clamp(centerY + random(-60, spreadY), 160, window.innerHeight - size.h - 34),
    r: random(-13, 13)
  };
}

function getPaperSize() {
  const styles = getComputedStyle(document.documentElement);
  return {
    w: parseFloat(styles.getPropertyValue("--paper-w")),
    h: parseFloat(styles.getPropertyValue("--paper-h"))
  };
}

function setEjectMotion(card, photo) {
  const size = getPaperSize();
  const slotRect = slot.getBoundingClientRect();
  const scale = slotRect.width / size.w;
  const startX = slotRect.left + size.w * (scale - 1) / 2;
  const startY = slotRect.top + slotRect.height * 0.54 - 1;
  const midScale = 1 + (scale - 1) * 0.48;
  const midX = startX + (photo.x - startX) * 0.52;
  const midY = startY + (photo.y - startY) * 0.52;
  const midR = photo.r * 0.45;

  card.style.setProperty("--eject-x", `${startX}px`);
  card.style.setProperty("--eject-y", `${startY}px`);
  card.style.setProperty("--eject-scale", scale.toFixed(3));
  card.style.setProperty("--mid-x", `${midX}px`);
  card.style.setProperty("--mid-y", `${midY}px`);
  card.style.setProperty("--mid-r", `${midR}deg`);
  card.style.setProperty("--mid-scale", midScale.toFixed(3));
  card.style.setProperty("--drop-x", `${photo.x}px`);
  card.style.setProperty("--drop-y", `${photo.y}px`);
  card.style.setProperty("--drop-r", `${photo.r}deg`);
}

function primeAudio() {
  ejectAudio.load();
}

function playEjectSound() {
  primeAudio();
  ejectAudio.currentTime = 0;
  ejectAudio.volume = 0.72;
  ejectAudio.play().catch(() => {});
}

function savePhotos() {
  const persisted = photos.map(({ ejecting, ...photo }) => photo);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(persisted));
}

function loadPhotos() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
    return saved.map((photo) => ({ ...photo, developed: true, ejecting: false, filterVersion: photo.filterVersion || 1 }));
  } catch {
    return [];
  }
}

function random(min, max) {
  return min + Math.random() * (max - min);
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}
