// Copyright 2026 Rockyljewell
// SPDX-License-Identifier: Apache-2.0

#if ANDROID
using System;
using System.Linq;
using Android.Webkit;
using Java.Interop;
using Microsoft.Maui.ApplicationModel;
using Microsoft.Maui.Handlers;
using Microsoft.Maui.Platform;
using AWebView = Android.Webkit.WebView;

namespace QRGen.Maui
{
    // Android notes:
    // * AndroidManifest.xml needs <uses-permission android:name="android.permission.CAMERA" /> and
    //   <uses-feature android:name="android.hardware.camera" android:required="false" />.
    // * The page calls window.QRGenAndroid.postMessage(json) (SPEC section 5).
    // * getUserMedia inside the WebView triggers WebChromeClient.OnPermissionRequest, which is granted
    //   below after the runtime CAMERA permission is granted to the app.
    public partial class QRGenWebViewHandler
    {
        private const string BridgeName = "QRGenAndroid";

        /// <inheritdoc />
        protected override void ConnectHandler(AWebView platformView)
        {
            base.ConnectHandler(platformView);
            platformView.Settings.JavaScriptEnabled = true;
            platformView.Settings.DomStorageEnabled = true;
            platformView.Settings.MediaPlaybackRequiresUserGesture = false;
            platformView.AddJavascriptInterface(new QRGenJavascriptBridge(this), BridgeName);
            platformView.SetWebChromeClient(new QRGenChromeClient(this));
        }

        /// <inheritdoc />
        protected override void DisconnectHandler(AWebView platformView)
        {
            platformView.RemoveJavascriptInterface(BridgeName);
            base.DisconnectHandler(platformView);
        }
    }

    internal sealed class QRGenJavascriptBridge : Java.Lang.Object
    {
        private readonly WeakReference<QRGenWebViewHandler> _handler;

        public QRGenJavascriptBridge(QRGenWebViewHandler handler) => _handler = new WeakReference<QRGenWebViewHandler>(handler);

        // Called by the page on a WebView background thread.
        [JavascriptInterface]
        [Export("postMessage")]
        public void PostMessage(string json)
        {
            if (_handler.TryGetTarget(out var handler)) handler.Deliver(json);
        }
    }

    internal sealed class QRGenChromeClient : MauiWebChromeClient
    {
        public QRGenChromeClient(WebViewHandler handler) : base(handler)
        {
        }

        public override void OnPermissionRequest(PermissionRequest? request)
        {
            if (request is null) return;
            var resources = request.GetResources() ?? Array.Empty<string>();
            if (!resources.Contains(PermissionRequest.ResourceVideoCapture))
            {
                base.OnPermissionRequest(request);
                return;
            }
            MainThread.BeginInvokeOnMainThread(async () =>
            {
                var status = await Permissions.RequestAsync<Permissions.Camera>();
                if (status == PermissionStatus.Granted) request.Grant(new[] { PermissionRequest.ResourceVideoCapture });
                else request.Deny();
            });
        }
    }
}
#endif
