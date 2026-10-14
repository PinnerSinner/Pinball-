using System.Windows;
using Envoy.App.Services;
using Envoy.App.Windows;

namespace Envoy.App;

/// <summary>
/// `Envoy.exe --smoke-test [log-path]`: builds every window under every theme, then exits 0 (or 1 with the error
/// in the log). CI runs this on a Windows runner so XAML resource and binding mistakes fail the build.
/// </summary>
internal static class SmokeTest
{
    public static bool IsRunning { get; private set; }

    public static async void Run(App app, string[] args)
    {
        IsRunning = true;
        var index = Array.IndexOf(args, "--smoke-test");
        var logPath = index + 1 < args.Length ? args[index + 1] : Path.Combine(Environment.CurrentDirectory, "smoke-test.log");
        var log = new List<string>();
        var exitCode = 0;
        try
        {
            var settingsPath = Path.Combine(Path.GetTempPath(), $"envoy-smoke-{Guid.NewGuid():N}", "settings.json");
            var host = new AppHost(settingsPath, app.Dispatcher);
            App.Host = host;
            log.Add("host created");

            log.Add("ocr languages: " + string.Join(", ", OcrService.InstalledLanguages().Select(l => l.WindowsTag)));

            foreach (var theme in ThemeManager.Themes)
            {
                ThemeManager.Apply(theme.Id);
                var main = new MainWindow(host);
                main.Show();
                foreach (var page in main.PageNames) main.Navigate(page);
                await Pump();
                main.Close();

                var overlay = new OverlayWindow(host);
                overlay.Show();
                host.ShowDemoMessages();
                overlay.ToggleEditMode();
                await Pump();
                overlay.ToggleEditMode();
                overlay.Close();

                var compose = new ComposeWindow(host);
                compose.Open(IntPtr.Zero);
                await Pump();
                compose.Close();

                var selector = new RegionSelectorWindow(new System.Drawing.Rectangle(0, 0, 800, 600), null);
                selector.Show();
                await Pump();
                selector.Close();

                log.Add($"theme {theme.Id}: ok");
            }

            // Capture + OCR pipeline once on a small screen area (the runner's desktop).
            var image = ScreenCapturer.Capture(new Core.Settings.ScreenRegion(0, 0, 320, 120), 2.0);
            ScreenCapturer.Preprocess(image, true, 1.3, false);
            var passes = await host.Ocr.RecognizeAsync(image);
            log.Add($"capture+ocr ok ({image.Width}x{image.Height}, {passes.Count} engines)");

            host.Dispose();
            log.Add("SMOKE TEST PASSED");
        }
        catch (Exception ex)
        {
            exitCode = 1;
            log.Add("SMOKE TEST FAILED");
            log.Add(ex.ToString());
        }

        File.WriteAllLines(logPath, log);
        app.Shutdown(exitCode);
    }

    private static async Task Pump() =>
        await Application.Current.Dispatcher.InvokeAsync(() => { }, System.Windows.Threading.DispatcherPriority.ApplicationIdle);
}
