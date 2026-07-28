using System.Diagnostics;
using System.IO;
using System.IO.Compression;
using System.Net.Http;
using System.Text.Json;
using NAudio.Wave;
using Vosk;

namespace VoiceInterpreter;

public sealed class SpeechRecognitionService
{
    private const int SampleRate = 16000;
    private const string SpanishModelUrl = "https://alphacephei.com/vosk/models/vosk-model-small-es-0.42.zip";
    private static readonly TimeSpan RecognitionTimeout = TimeSpan.FromSeconds(10);
    private readonly AppSettings settings;
    private readonly SemaphoreSlim audioLock;

    public SpeechRecognitionService(AppSettings settings, SemaphoreSlim audioLock)
    {
        this.settings = settings;
        this.audioLock = audioLock;
    }

    public async Task<string?> RecognizeSpanishOnceAsync(CancellationToken cancellationToken = default)
    {
        string modelPath = GetSpanishModelPath();
        if (!IsSpanishModelInstalled())
        {
            throw new DirectoryNotFoundException(
                $"No se encontró el modelo de español de Vosk en '{modelPath}'. " +
                "Descarga y descomprime el modelo pequeño de español en esa ubicación.");
        }

        LogInputDevices();
        if (WaveIn.DeviceCount == 0)
        {
            throw new InvalidOperationException("Windows no detectó ningún micrófono o dispositivo de entrada de audio.");
        }

        await audioLock.WaitAsync(cancellationToken);

        try
        {
            return await Task.Run(() => RecognizeAsync(modelPath, cancellationToken), cancellationToken);
        }
        finally
        {
            audioLock.Release();
        }
    }

    public string GetSpanishModelPath()
    {
        return Path.GetFullPath(settings.SpanishVoskModelPath, AppContext.BaseDirectory);
    }

    public bool IsSpanishModelInstalled()
    {
        string modelPath = GetSpanishModelPath();
        return Directory.Exists(Path.Combine(modelPath, "am"))
            && Directory.Exists(Path.Combine(modelPath, "conf"));
    }

    public async Task DownloadSpanishModelAsync(IProgress<double>? progress = null, CancellationToken cancellationToken = default)
    {
        if (IsSpanishModelInstalled())
        {
            progress?.Report(1);
            return;
        }

        string modelPath = GetSpanishModelPath();
        string modelsDirectory = Directory.GetParent(modelPath)?.FullName
            ?? throw new InvalidOperationException($"La ruta del modelo no es válida: '{modelPath}'.");
        string temporaryZipPath = Path.Combine(Path.GetTempPath(), $"vosk-model-small-es-0.42-{Guid.NewGuid():N}.zip");

        Directory.CreateDirectory(modelsDirectory);

        try
        {
            using HttpClient httpClient = new();
            using HttpResponseMessage response = await httpClient.GetAsync(
                SpanishModelUrl, HttpCompletionOption.ResponseHeadersRead, cancellationToken);
            response.EnsureSuccessStatusCode();

            long? totalBytes = response.Content.Headers.ContentLength;
            await using Stream source = await response.Content.ReadAsStreamAsync(cancellationToken);
            await using FileStream destination = new(
                temporaryZipPath, FileMode.Create, FileAccess.Write, FileShare.None, 81920, useAsync: true);

            byte[] buffer = new byte[81920];
            long downloadedBytes = 0;
            int bytesRead;

            while ((bytesRead = await source.ReadAsync(buffer, cancellationToken)) > 0)
            {
                await destination.WriteAsync(buffer.AsMemory(0, bytesRead), cancellationToken);
                downloadedBytes += bytesRead;

                if (totalBytes > 0)
                {
                    progress?.Report((double)downloadedBytes / totalBytes.Value);
                }
            }

            await destination.FlushAsync(cancellationToken);
            await destination.DisposeAsync();
            ZipFile.ExtractToDirectory(temporaryZipPath, modelsDirectory, overwriteFiles: true);

            if (!IsSpanishModelInstalled())
            {
                throw new InvalidDataException(
                    $"El archivo se descargó, pero no contiene un modelo válido en '{modelPath}'.");
            }

            progress?.Report(1);
        }
        finally
        {
            if (File.Exists(temporaryZipPath))
            {
                File.Delete(temporaryZipPath);
            }
        }
    }

    private static async Task<string?> RecognizeAsync(string modelPath, CancellationToken cancellationToken)
    {
        using Model model = new(modelPath);
        using VoskRecognizer recognizer = new(model, SampleRate);
        using WaveInEvent microphone = new()
        {
            DeviceNumber = 0,
            WaveFormat = new WaveFormat(SampleRate, 16, 1),
            BufferMilliseconds = 100
        };
        using CancellationTokenSource timeout = new(RecognitionTimeout);
        using CancellationTokenSource linkedCancellation = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken, timeout.Token);

        TaskCompletionSource<string?> recognitionCompleted = new(TaskCreationOptions.RunContinuationsAsynchronously);
        TaskCompletionSource recordingStopped = new(TaskCreationOptions.RunContinuationsAsynchronously);

        EventHandler<WaveInEventArgs> dataAvailable = (_, eventArgs) =>
        {
            try
            {
                if (recognizer.AcceptWaveform(eventArgs.Buffer, eventArgs.BytesRecorded))
                {
                    string? text = ExtractText(recognizer.Result());
                    if (!string.IsNullOrWhiteSpace(text))
                    {
                        recognitionCompleted.TrySetResult(text);
                    }
                }
            }
            catch (Exception exception)
            {
                recognitionCompleted.TrySetException(exception);
            }
        };

        EventHandler<StoppedEventArgs> recordingStoppedHandler = (_, eventArgs) =>
        {
            if (eventArgs.Exception is not null)
            {
                recognitionCompleted.TrySetException(eventArgs.Exception);
            }
            else
            {
                recognitionCompleted.TrySetResult(null);
            }

            recordingStopped.TrySetResult();
        };

        microphone.DataAvailable += dataAvailable;
        microphone.RecordingStopped += recordingStoppedHandler;

        using CancellationTokenRegistration registration = linkedCancellation.Token.Register(() =>
        {
            if (cancellationToken.IsCancellationRequested)
            {
                recognitionCompleted.TrySetCanceled(cancellationToken);
            }
            else
            {
                recognitionCompleted.TrySetResult(null);
            }
        });

        try
        {
            microphone.StartRecording();
            return await recognitionCompleted.Task;
        }
        finally
        {
            microphone.StopRecording();

            try
            {
                await recordingStopped.Task.WaitAsync(TimeSpan.FromSeconds(2));
            }
            catch (TimeoutException)
            {
                Debug.WriteLine("El micrófono no confirmó su detención dentro del tiempo esperado.");
            }

            microphone.DataAvailable -= dataAvailable;
            microphone.RecordingStopped -= recordingStoppedHandler;
        }
    }

    private static string? ExtractText(string json)
    {
        using JsonDocument document = JsonDocument.Parse(json);
        return document.RootElement.TryGetProperty("text", out JsonElement textElement)
            ? textElement.GetString()
            : null;
    }

    private static void LogInputDevices()
    {
        Debug.WriteLine($"Dispositivos de entrada detectados: {WaveIn.DeviceCount}");

        for (int index = 0; index < WaveIn.DeviceCount; index++)
        {
            WaveInCapabilities device = WaveIn.GetCapabilities(index);
            Debug.WriteLine($"- [{index}] {device.ProductName}");
        }
    }
}
