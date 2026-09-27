export interface Platform {
  id: string;
  label: string;
  icon: string;
  /** Docs page slug. */
  doc: string;
  language: string;
  status: "stable" | "beta" | "preview" | "guide";
  install: string;
  summary: string;
}

/** The chips shown in the "SDK & Frameworks" hero, in display order. */
export const HERO_PLATFORMS = ["ios", "android", "javascript", "react-native", "cordova", "xamarin", "flutter", "dotnet", "capacitor", "titanium", "linux"];

export const PLATFORMS: Platform[] = [
  { id: "ios", label: "iOS", icon: "apple", doc: "ios", language: "Swift", status: "beta", install: "Swift Package: https://github.com/Rockyljewell/QR-GEN", summary: "AVFoundation + Vision scanner with SwiftUI and UIKit views." },
  { id: "android", label: "Android", icon: "android", doc: "android", language: "Kotlin", status: "beta", install: "implementation(\"com.github.Rockyljewell.QR-GEN:qrgen-compose:main-SNAPSHOT\")", summary: "CameraX + ML Kit scanner view and Jetpack Compose component." },
  { id: "javascript", label: "JavaScript", icon: "js", doc: "javascript", language: "TypeScript", status: "stable", install: "npm install qrgen-sdk", summary: "Web SDK with a drop-in scanner element, workers and WebAssembly." },
  { id: "react-native", label: "React Native", icon: "react", doc: "react-native", language: "TypeScript", status: "beta", install: "npm install https://rockyljewell.github.io/QR-GEN/downloads/qrgen-react-native.tgz", summary: "Native camera scanning via VisionCamera, or the zero-setup WebView scanner." },
  { id: "cordova", label: "Cordova", icon: "cordova", doc: "cordova", language: "JavaScript", status: "guide", install: "npm install qrgen-sdk", summary: "Use the web SDK inside Cordova's WebView." },
  { id: "xamarin", label: "Xamarin", icon: "xamarin", doc: "dotnet", language: "C#", status: "guide", install: "dotnet add package QRGen.Net", summary: "Xamarin is end-of-life: use .NET MAUI with the QRGen bridge." },
  { id: "flutter", label: "Flutter", icon: "flutter", doc: "flutter", language: "Dart", status: "beta", install: "flutter pub add qrgen_flutter --git-url https://github.com/Rockyljewell/QR-GEN.git --git-path packages/flutter", summary: "Native scanner widget plus a WebView scanner for full symbology coverage." },
  { id: "dotnet", label: ".NET", icon: "dotnet", doc: "dotnet", language: "C#", status: "beta", install: "dotnet pack packages/dotnet/src/QRGen.Net -o nupkg", summary: "Parsers, REST client, local decode/encode and a MAUI scanner page." },
  { id: "capacitor", label: "Capacitor", icon: "capacitor", doc: "capacitor", language: "TypeScript", status: "stable", install: "npm install qrgen-sdk", summary: "The web SDK runs as-is in Capacitor and Ionic apps." },
  { id: "titanium", label: "Titanium", icon: "titanium", doc: "titanium", language: "JavaScript", status: "guide", install: "Ti.UI.createWebView({ url: embedUrl })", summary: "Embed the hosted scanner in a Titanium WebView." },
  { id: "linux", label: "Linux", icon: "linux", doc: "linux", language: "Python · Node", status: "stable", install: "npx qrgen scan photo.jpg", summary: "Python + OpenCV webcams, the CLI, or the REST API on any Linux box." },
  { id: "react", label: "React", icon: "react", doc: "react", language: "TypeScript", status: "stable", install: "npm install qrgen-sdk", summary: "<QRGenScanner> and <QRGenBarcode> components." },
  { id: "vue", label: "Vue", icon: "vue", doc: "vue", language: "TypeScript", status: "stable", install: "npm install qrgen-sdk", summary: "Vue 3 components and plugin, Nuxt-ready." },
  { id: "angular", label: "Angular", icon: "angular", doc: "angular", language: "TypeScript", status: "stable", install: "npm install qrgen-sdk", summary: "Standard custom element with CUSTOM_ELEMENTS_SCHEMA." },
  { id: "svelte", label: "Svelte", icon: "svelte", doc: "svelte", language: "TypeScript", status: "stable", install: "npm install qrgen-sdk", summary: "Works with Svelte 4/5 and SvelteKit." },
  { id: "nextjs", label: "Next.js", icon: "react", doc: "nextjs", language: "TypeScript", status: "stable", install: "npm install qrgen-sdk", summary: "Client component with dynamic import." },
  { id: "electron", label: "Electron", icon: "electron", doc: "electron", language: "TypeScript", status: "stable", install: "npm install qrgen-sdk", summary: "Camera scanning in the renderer, file scanning in main." },
  { id: "tauri", label: "Tauri", icon: "tauri", doc: "tauri", language: "TypeScript", status: "guide", install: "npm install qrgen-sdk", summary: "Web SDK inside the Tauri WebView." },
  { id: "node", label: "Node.js", icon: "node", doc: "nodejs", language: "TypeScript", status: "stable", install: "npm install qrgen-sdk", summary: "Scan and generate files on servers and serverless." },
  { id: "python", label: "Python", icon: "python", doc: "python", language: "Python", status: "beta", install: "pip install \"git+https://github.com/Rockyljewell/QR-GEN.git#subdirectory=packages/python\"", summary: "Scan images and webcams, generate codes, run the REST API." },
  { id: "rest", label: "REST API", icon: "docker", doc: "rest-api", language: "HTTP", status: "stable", install: "docker run -p 8080:8080 ghcr.io/rockyljewell/qr-gen", summary: "Any language, any platform: POST an image, get JSON." },
];

export const PLATFORM_BY_ID = new Map(PLATFORMS.map((p) => [p.id, p]));
