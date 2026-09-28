// Copyright 2026 Rockyljewell
// SPDX-License-Identifier: Apache-2.0

using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;
using Microsoft.Maui;
using Microsoft.Maui.ApplicationModel;
using Microsoft.Maui.Controls;
using QRGen.Embed;

namespace QRGen.Maui
{
    /// <summary>Barcodes reported by a <c>scan</c> event.</summary>
    public sealed class QRGenScanEventArgs : EventArgs
    {
        internal QRGenScanEventArgs(IReadOnlyList<Barcode> barcodes) => Barcodes = barcodes;

        /// <summary>The new barcodes (SPEC section 2).</summary>
        public IReadOnlyList<Barcode> Barcodes { get; }
    }

    /// <summary>Tracked barcodes reported by a <c>track</c> event (batch mode).</summary>
    public sealed class QRGenTrackEventArgs : EventArgs
    {
        internal QRGenTrackEventArgs(IReadOnlyList<TrackedBarcode> tracked) => Tracked = tracked;

        /// <summary>Every code currently tracked.</summary>
        public IReadOnlyList<TrackedBarcode> Tracked { get; }
    }

    /// <summary>A scanner error (SPEC section 4 error codes, for example <c>camera-permission-denied</c>).</summary>
    public sealed class QRGenErrorEventArgs : EventArgs
    {
        internal QRGenErrorEventArgs(string code, string message)
        {
            Code = code;
            Message = message;
        }

        /// <summary>Error code.</summary>
        public string Code { get; }

        /// <summary>Human readable message.</summary>
        public string Message { get; }
    }

    /// <summary>
    /// Full-screen barcode scanner for .NET MAUI (Android, iOS, Mac Catalyst, Windows). It hosts the
    /// QRGen embed page (<see cref="EmbedOptions.DefaultBaseUrl"/>) in a <see cref="QRGenWebView"/> and
    /// raises <see cref="Scanned"/>, <see cref="Tracked"/>, <see cref="ScannerError"/> and <see cref="Ready"/>.
    /// </summary>
    /// <example>
    /// <code>
    /// // MauiProgram.cs: builder.UseMauiApp&lt;App&gt;().UseQRGen();
    /// var barcode = await QRGenScannerPage.ScanOnceAsync(Navigation, new EmbedOptions { Symbologies = { "qr", "ean13" } });
    /// if (barcode is not null) await DisplayAlert(barcode.SymbologyName, barcode.Data, "OK");
    /// </code>
    /// </example>
    public class QRGenScannerPage : ContentPage
    {
        private readonly QRGenWebView _webView;
        private readonly Label _status;
        private bool _loaded;

        /// <summary>Creates a scanner page.</summary>
        public QRGenScannerPage(EmbedOptions? options = null)
        {
            Options = options ?? new EmbedOptions();
            Title = "Scan";
            _webView = new QRGenWebView { HorizontalOptions = LayoutOptions.Fill, VerticalOptions = LayoutOptions.Fill };
            _webView.MessageReceived += OnMessageReceived;
            _status = new Label { IsVisible = false, Margin = 24, HorizontalTextAlignment = TextAlignment.Center, VerticalOptions = LayoutOptions.Center };
            Content = new Grid { Children = { _webView, _status } };
        }

        /// <summary>Scanner options (read when the page first appears).</summary>
        public EmbedOptions Options { get; }

        /// <summary>Raised on the UI thread with new barcodes.</summary>
        public event EventHandler<QRGenScanEventArgs>? Scanned;

        /// <summary>Raised on the UI thread in batch mode with the tracked set.</summary>
        public event EventHandler<QRGenTrackEventArgs>? Tracked;

        /// <summary>Raised when the camera cannot be used (permission denied, not found, in use...).</summary>
        public event EventHandler<QRGenErrorEventArgs>? ScannerError;

        /// <summary>Raised when the camera is running.</summary>
        public event EventHandler? Ready;

        /// <summary>Starts (or restarts) scanning.</summary>
        public Task StartAsync() => RunAsync(EmbedCommands.Start);

        /// <summary>Stops scanning and releases the camera.</summary>
        public Task StopAsync() => RunAsync(EmbedCommands.Stop);

        /// <summary>Pauses decoding; the camera stays on.</summary>
        public Task PauseAsync() => RunAsync(EmbedCommands.Pause);

        /// <summary>Resumes decoding.</summary>
        public Task ResumeAsync() => RunAsync(EmbedCommands.Resume);

        /// <summary>Turns the flashlight on or off (where the device supports it).</summary>
        public Task SetTorchAsync(bool on) => RunAsync(EmbedCommands.Torch(on));

        /// <summary>
        /// Shows a modal scanner in <c>single</c> mode and returns the first barcode, or <c>null</c> when the
        /// user closes the page or the camera is unavailable.
        /// </summary>
        public static async Task<Barcode?> ScanOnceAsync(INavigation navigation, EmbedOptions? options = null)
        {
            options ??= new EmbedOptions();
            options.Mode = "single";
            var completion = new TaskCompletionSource<Barcode?>();
            var page = new QRGenScannerPage(options);
            page.ToolbarItems.Add(new ToolbarItem("Cancel", null, async () =>
            {
                completion.TrySetResult(null);
                await navigation.PopModalAsync();
            }));
            page.Scanned += async (_, e) =>
            {
                if (completion.TrySetResult(e.Barcodes.FirstOrDefault())) await navigation.PopModalAsync();
            };
            page.ScannerError += (_, _) => completion.TrySetResult(null);
            page.Disappearing += (_, _) => completion.TrySetResult(null);
            await navigation.PushModalAsync(new NavigationPage(page));
            return await completion.Task;
        }

        /// <inheritdoc />
        protected override async void OnAppearing()
        {
            base.OnAppearing();
            // The WebView can only use the camera after the app itself holds the camera permission
            // (Android CAMERA, iOS/Mac Catalyst NSCameraUsageDescription, Windows "webcam" capability).
            var status = await Permissions.CheckStatusAsync<Permissions.Camera>();
            if (status != PermissionStatus.Granted) status = await Permissions.RequestAsync<Permissions.Camera>();
            if (status != PermissionStatus.Granted)
            {
                ShowStatus("Camera access is needed to scan barcodes. Enable it in Settings.");
                ScannerError?.Invoke(this, new QRGenErrorEventArgs("camera-permission-denied", "Camera permission was denied."));
                return;
            }
            if (!_loaded)
            {
                _loaded = true;
                _webView.Source = new UrlWebViewSource { Url = Options.BuildUri().ToString() };
            }
            else
            {
                await StartAsync();
            }
        }

        /// <inheritdoc />
        protected override async void OnDisappearing()
        {
            base.OnDisappearing();
            await StopAsync(); // release the camera while the page is hidden
        }

        private async Task RunAsync(string script)
        {
            if (!_loaded) return;
            try
            {
                await _webView.EvaluateJavaScriptAsync(script);
            }
            catch (Exception)
            {
                // The page may still be loading; commands are best effort.
            }
        }

        private void ShowStatus(string text)
        {
            _status.Text = text;
            _status.IsVisible = true;
            _webView.IsVisible = false;
        }

        private void OnMessageReceived(object? sender, QRGenMessageEventArgs e)
        {
            var message = e.Message;
            switch (message.Type)
            {
                case "scan":
                    Scanned?.Invoke(this, new QRGenScanEventArgs(message.Barcodes ?? Array.Empty<Barcode>()));
                    break;
                case "track":
                    Tracked?.Invoke(this, new QRGenTrackEventArgs(message.Tracked ?? Array.Empty<TrackedBarcode>()));
                    break;
                case "error":
                    ScannerError?.Invoke(this, new QRGenErrorEventArgs(message.Code ?? "unknown", message.Message ?? string.Empty));
                    break;
                case "ready":
                    Ready?.Invoke(this, EventArgs.Empty);
                    break;
            }
        }
    }
}
