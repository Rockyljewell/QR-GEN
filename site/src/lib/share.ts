// Share targets for the share dialog and footer. Links are built at build time from the page's
// canonical URL, so they work without JavaScript. Brand glyphs come from simple-icons (CC0).
import { siBluesky, siFacebook, siMastodon, siReddit, siTelegram, siThreads, siWhatsapp, siX, siYcombinator } from "simple-icons";

export interface ShareTarget {
  id: string;
  label: string;
  href: string;
  /** SVG path (24×24 viewBox, filled). */
  path: string;
  /** Brand color for hover states. */
  color: string;
}

// simple-icons no longer ships a LinkedIn glyph, so this is a plain "in" mark.
const LINKEDIN_PATH =
  "M4 3h16a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1zm2.5 7v7.5h2.6V10zm1.3-4.1a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3zM11 10v7.5h2.6v-4c0-1.1.6-1.8 1.5-1.8s1.3.6 1.3 1.7v4.1H19v-4.6c0-2.3-1.2-3.5-3.1-3.5-1.1 0-1.9.5-2.4 1.2V10z";
const MAIL_PATH =
  "M3 5h18a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1zm1.6 2 7.4 5.6L19.4 7zM20 8.6l-7.4 5.6a1 1 0 0 1-1.2 0L4 8.6V17h16z";
const SMS_PATH =
  "M4 3h16a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H9l-5 4v-4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2zm3 7a1.3 1.3 0 1 0 0 2.6A1.3 1.3 0 0 0 7 10zm5 0a1.3 1.3 0 1 0 0 2.6 1.3 1.3 0 0 0 0-2.6zm5 0a1.3 1.3 0 1 0 0 2.6 1.3 1.3 0 0 0 0-2.6z";

export const SHARE_BLURB = "QRGen: free, open-source barcode, QR code and ID scanning for every platform";

/** Every share target for a page. `title` is the page title, `url` its canonical URL. */
export function shareTargets(url: string, title: string): ShareTarget[] {
  const text = title.includes("QRGen") ? title : `${title} | QRGen`;
  const e = encodeURIComponent;
  const withUrl = `${text} ${url}`;
  return [
    { id: "x", label: "X", href: `https://x.com/intent/tweet?text=${e(text)}&url=${e(url)}`, path: siX.path, color: "#000000" },
    { id: "linkedin", label: "LinkedIn", href: `https://www.linkedin.com/sharing/share-offsite/?url=${e(url)}`, path: LINKEDIN_PATH, color: "#0a66c2" },
    { id: "facebook", label: "Facebook", href: `https://www.facebook.com/sharer/sharer.php?u=${e(url)}`, path: siFacebook.path, color: `#${siFacebook.hex}` },
    { id: "reddit", label: "Reddit", href: `https://www.reddit.com/submit?url=${e(url)}&title=${e(text)}`, path: siReddit.path, color: `#${siReddit.hex}` },
    { id: "hackernews", label: "Hacker News", href: `https://news.ycombinator.com/submitlink?u=${e(url)}&t=${e(text)}`, path: siYcombinator.path, color: `#${siYcombinator.hex}` },
    { id: "bluesky", label: "Bluesky", href: `https://bsky.app/intent/compose?text=${e(withUrl)}`, path: siBluesky.path, color: `#${siBluesky.hex}` },
    { id: "mastodon", label: "Mastodon", href: `https://mastodon.social/share?text=${e(withUrl)}`, path: siMastodon.path, color: `#${siMastodon.hex}` },
    { id: "threads", label: "Threads", href: `https://www.threads.net/intent/post?text=${e(withUrl)}`, path: siThreads.path, color: "#000000" },
    { id: "whatsapp", label: "WhatsApp", href: `https://wa.me/?text=${e(withUrl)}`, path: siWhatsapp.path, color: `#${siWhatsapp.hex}` },
    { id: "telegram", label: "Telegram", href: `https://t.me/share/url?url=${e(url)}&text=${e(text)}`, path: siTelegram.path, color: `#${siTelegram.hex}` },
    { id: "email", label: "Email", href: `mailto:?subject=${e(text)}&body=${e(`${SHARE_BLURB}\n\n${url}`)}`, path: MAIL_PATH, color: "#0e1726" },
    { id: "sms", label: "Text message", href: `sms:?&body=${e(withUrl)}`, path: SMS_PATH, color: "#34c759" },
  ];
}

/** The targets shown inline in the footer; the rest are one click away in the dialog. */
export const FOOTER_TARGETS = ["x", "linkedin", "facebook", "reddit", "hackernews", "bluesky", "whatsapp", "email"];
