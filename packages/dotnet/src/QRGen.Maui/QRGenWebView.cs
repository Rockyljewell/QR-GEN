// Copyright 2026 Rockyljewell
// SPDX-License-Identifier: Apache-2.0

using System;
using Microsoft.Maui.Controls;
using QRGen.Embed;

namespace QRGen.Maui
{
    /// <summary>Event data for a message posted by the QRGen embed page.</summary>
    public sealed class QRGenMessageEventArgs : EventArgs
    {
        internal QRGenMessageEventArgs(EmbedMessage message, string json)
        {
            Message = message;
            Json = json;
        }

        /// <summary>The parsed message envelope (SPEC section 5).</summary>
        public EmbedMessage Message { get; }

        /// <summary>The raw JSON string received from the page.</summary>
        public string Json { get; }
    }

    /// <summary>
    /// A <see cref="WebView"/> that receives QRGen embed messages through the platform channel:
    /// <c>window.chrome.webview.postMessage</c> (WebView2), <c>window.webkit.messageHandlers.qrgen</c>
    /// (WKWebView) or <c>window.QRGenAndroid.postMessage</c> (Android). Register its handler with
    /// <see cref="QRGenMauiAppBuilderExtensions.UseQRGen"/>.
    /// </summary>
    public class QRGenWebView : WebView
    {
        /// <summary>Raised on the UI thread for every QRGen message.</summary>
        public event EventHandler<QRGenMessageEventArgs>? MessageReceived;

        internal void RaiseMessage(string json)
        {
            var message = EmbedMessage.TryParse(json);
            if (message is not null) MessageReceived?.Invoke(this, new QRGenMessageEventArgs(message, json));
        }
    }
}
