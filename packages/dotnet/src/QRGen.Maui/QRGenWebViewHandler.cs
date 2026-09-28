// Copyright 2026 Rockyljewell
// SPDX-License-Identifier: Apache-2.0

using Microsoft.Maui.ApplicationModel;
using Microsoft.Maui.Handlers;
using Microsoft.Maui.Hosting;

namespace QRGen.Maui
{
    /// <summary>
    /// WebView handler that wires the platform message channel of <see cref="QRGenWebView"/> and grants
    /// the page camera access. Platform parts live in <c>Platforms/Android</c>, <c>Platforms/Apple</c>
    /// and <c>Platforms/Windows</c>.
    /// </summary>
    public partial class QRGenWebViewHandler : WebViewHandler
    {
        /// <summary>Delivers a JSON string from the page to the virtual view on the UI thread.</summary>
        internal void Deliver(string json)
        {
            MainThread.BeginInvokeOnMainThread(() => (VirtualView as QRGenWebView)?.RaiseMessage(json));
        }
    }

    /// <summary>Registration helpers.</summary>
    public static class QRGenMauiAppBuilderExtensions
    {
        /// <summary>Registers <see cref="QRGenWebViewHandler"/> for <see cref="QRGenWebView"/>. Call from <c>MauiProgram.CreateMauiApp</c>.</summary>
        public static MauiAppBuilder UseQRGen(this MauiAppBuilder builder)
        {
            builder.ConfigureMauiHandlers(handlers => handlers.AddHandler<QRGenWebView, QRGenWebViewHandler>());
            return builder;
        }
    }
}
