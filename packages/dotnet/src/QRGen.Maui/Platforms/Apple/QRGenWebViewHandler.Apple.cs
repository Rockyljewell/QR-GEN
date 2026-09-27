#if IOS || MACCATALYST
using System;
using CoreGraphics;
using Foundation;
using Microsoft.Maui.Handlers;
using Microsoft.Maui.Platform;
using WebKit;

namespace QRGen.Maui
{
    // iOS / Mac Catalyst notes:
    // * Info.plist needs NSCameraUsageDescription ("Scan barcodes with the camera").
    //   Mac Catalyst also needs the com.apple.security.device.camera entitlement.
    // * WKWebView supports getUserMedia on iOS 14.3+; inline playback must be enabled when the
    //   configuration is created, which is why CreatePlatformView is overridden.
    // * The page calls window.webkit.messageHandlers.qrgen.postMessage(json) (SPEC section 5).
    // * iOS 15+: the UI delegate grants the page camera access without a second web prompt.
    public partial class QRGenWebViewHandler
    {
        private const string HandlerName = "qrgen";

        /// <inheritdoc />
        protected override WKWebView CreatePlatformView()
        {
            var configuration = MauiWKWebView.CreateConfiguration();
            configuration.AllowsInlineMediaPlayback = true;
            configuration.MediaTypesRequiringUserActionForPlayback = WKAudiovisualMediaTypes.None;
            configuration.UserContentController.AddScriptMessageHandler(new QRGenScriptMessageHandler(this), HandlerName);
            return new MauiWKWebView(CGRect.Empty, this, configuration);
        }

        /// <inheritdoc />
        protected override void ConnectHandler(WKWebView platformView)
        {
            base.ConnectHandler(platformView);
            platformView.UIDelegate = new QRGenUIDelegate(this);
        }

        /// <inheritdoc />
        protected override void DisconnectHandler(WKWebView platformView)
        {
            platformView.Configuration.UserContentController.RemoveScriptMessageHandler(HandlerName);
            base.DisconnectHandler(platformView);
        }
    }

    internal sealed class QRGenScriptMessageHandler : NSObject, IWKScriptMessageHandler
    {
        private readonly WeakReference<QRGenWebViewHandler> _handler;

        public QRGenScriptMessageHandler(QRGenWebViewHandler handler) => _handler = new WeakReference<QRGenWebViewHandler>(handler);

        public void DidReceiveScriptMessage(WKUserContentController userContentController, WKScriptMessage message)
        {
            if (_handler.TryGetTarget(out var handler)) handler.Deliver(message.Body?.ToString() ?? string.Empty);
        }
    }

    internal sealed class QRGenUIDelegate : MauiWebViewUIDelegate
    {
        public QRGenUIDelegate(IWebViewHandler handler) : base(handler)
        {
        }

        public override void RequestMediaCapturePermission(WKWebView webView, WKSecurityOrigin origin, WKFrameInfo frame,
            WKMediaCaptureType type, Action<WKPermissionDecision> decisionHandler)
        {
            // Grant camera access to the page that is loaded (the QRGen embed page); anything else
            // (for example an iframe from another origin) falls back to the system prompt.
            var pageHost = webView.Url?.Host ?? string.Empty;
            var requester = origin.Host ?? string.Empty;
            decisionHandler(pageHost.Length > 0 && string.Equals(pageHost, requester, StringComparison.OrdinalIgnoreCase)
                ? WKPermissionDecision.Grant
                : WKPermissionDecision.Prompt);
        }
    }
}
#endif
