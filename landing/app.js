const REPO = "cvpfus/snipname";
const WORKFLOW = "build-windows.yml";

const menu = document.querySelector(".menu");
const sheet = document.querySelector("#sheet");

menu.addEventListener("click", () => {
  const open = menu.getAttribute("aria-expanded") === "true";
  menu.setAttribute("aria-expanded", String(!open));
  menu.setAttribute("aria-label", open ? "Open menu" : "Close menu");
  sheet.hidden = open;
  requestAnimationFrame(() => sheet.classList.toggle("open", !open));
});

sheet.querySelectorAll("a").forEach((link) => {
  link.addEventListener("click", () => {
    menu.setAttribute("aria-expanded", "false");
    menu.setAttribute("aria-label", "Open menu");
    sheet.classList.remove("open");
    sheet.hidden = true;
  });
});

const reveals = document.querySelectorAll(".reveal");
const revealObserver = new IntersectionObserver(
  (entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        entry.target.classList.add("in");
        revealObserver.unobserve(entry.target);
      }
    });
  },
  { threshold: 0.18 }
);
reveals.forEach((node) => revealObserver.observe(node));

const tagline = document.querySelector("#tagline");
const words = [];
tagline.querySelectorAll("span").forEach((line) => {
  const parts = line.textContent.trim().split(/\s+/);
  line.textContent = "";
  parts.forEach((part, index) => {
    const word = document.createElement("span");
    word.className = "word";
    word.textContent = part;
    line.append(word);
    if (index < parts.length - 1) line.append(" ");
    words.push(word);
  });
});

const wordObserver = new IntersectionObserver(
  (entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        entry.target.classList.add("on");
        wordObserver.unobserve(entry.target);
      }
    });
  },
  { rootMargin: "0px 0px -12% 0px", threshold: 0.6 }
);
words.forEach((word) => wordObserver.observe(word));

async function latestArtifact() {
  const res = await fetch("/api/latest");
  if (!res.ok) throw new Error(`latest ${res.status}`);
  const body = await res.json();
  if (!body.ok) throw new Error(body.error || "latest failed");
  return body;
}

function formatWhen(iso) {
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso));
}

function formatSize(bytes) {
  const mb = bytes / (1024 * 1024);
  return `${mb.toFixed(1)} MB`;
}

const meta = document.querySelector("#build-meta");
const proof = document.querySelector("#proof");
const downloadBtn = document.querySelector("#download-btn");
const heroDownload = document.querySelector("#hero-download");
const navDownload = document.querySelector("#nav-download");
const closeDownload = document.querySelector("#close-download");
const runLink = document.querySelector("#run-link");

function pointDownloads(href, label) {
  downloadBtn.href = href;
  downloadBtn.removeAttribute("aria-disabled");
  downloadBtn.textContent = label;
  heroDownload.href = href;
  navDownload.href = href;
  closeDownload.href = href;
}

latestArtifact()
  .then((latest) => {
    const when = formatWhen(latest.builtAt);
    meta.textContent = `Built ${when} · ${latest.sha} · ${formatSize(latest.size)} zip · NSIS setup inside`;
    proof.textContent = `Latest Windows build · ${when} · ${formatSize(latest.size)}`;
    pointDownloads(latest.zipUrl, "Download Windows zip");
    runLink.href = latest.runUrl;
  })
  .catch(() => {
    const fallback = `https://github.com/${REPO}/actions/workflows/${WORKFLOW}`;
    meta.textContent =
      "Could not read the latest artifact from here. Open the Windows build and download snipname-windows.";
    pointDownloads(fallback, "Open Windows builds");
  });
