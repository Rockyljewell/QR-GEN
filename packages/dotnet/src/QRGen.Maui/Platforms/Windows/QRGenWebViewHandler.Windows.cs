#if WINDOWS
using System;
using Microsoft.UI.Xaml.Controls;
using Microsoft.Web.WebView2.Core;

namespace QRGen.Maui
{
    // Windows notes:
    // * Package.appxmanifest needs <DeviceCapability Name="webcam" /> (and "microphone" is not needed).
    // * The page calls window.chrome.webview.postMessage(json) (SPEC section 5), which arrives as
    //   CoreWebView2.WebMessageReceived.
    // * Camera requests from the page are allowed in PermissionRequested so no WebView2 prompt appears.
    public partial class QRGenWebViewHandler
    {
        /// <inheritdoc />
        protected override void ConnectHandler(WebView2 platformView)
        {
            base.ConnectHandler(platformView);
            platformView.CoreWebView2Initialized += OnCoreWebView2Initialized;
            if (platformView.CoreWebView2 is not null) Attach(platformView.CoreWebView2);
        }

        /// <inheritdoc />
        protected override void DisconnectHandler(WebView2 platformView)
        {
            platformView.CoreWebView2Initialized -= OnCoreWebView2Initialized;
            if (platformView.CoreWebView2 is { } core)
            {
                core.WebMessageReceived -= OnWebMessageReceived;
                core.PermissionRequested -= OnPermissionRequested;
            }
            base.DisconnectHandler(platformView);
        }

        private void OnCoreWebView2Initialized(WebView2 sender, CoreWebView2InitializedEventArgs args)
        {
            if (sender.CoreWebView2 is { } core) Attach(core);
        }

        private void Attach(CoreWebView2 core)
        {
            core.WebMessageReceived -= OnWebMessageReceived;
            core.WebMessageReceived += OnWebMessageReceived;
            core.PermissionRequested -= OnPermissionRequested;
            core.PermissionRequested += OnPermissionRequested;
        }

        private void OnWebMessageReceived(CoreWebView2 sender, CoreWebView2WebMessageReceivedEventArgs args)
        {
            string json;
            try
            {
                json = args.TryGetWebMessageAsString();
            }
            catch (ArgumentException)
            {
                json = args.WebMessageAsJson; // the page posted an object instead of a string
            }
            Deliver(json);
        }

        private static void OnPermissionRequested(CoreWebView2 sender, CoreWebView2PermissionRequestedEventArgs args)
        {
            if (args.PermissionKind == CoreWebView2PermissionKind.Camera) args.State = CoreWebView2PermissionState.Allow;
        }
    }
}
#endif
