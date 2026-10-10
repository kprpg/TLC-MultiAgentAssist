import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { join } from 'node:path'
import {
    voiceAvailabilitySchema, voiceContractVersion, voiceSourceEventSchema,
    type VoiceAvailability, type VoiceCaptureDriver, type VoiceCaptureHandle,
    type VoiceSourceEvent, type VoiceStartRequest
} from '../../common/contracts/voice.js'

const speechProgram = String.raw`
Add-Type -AssemblyName System.Speech,System.Web.Extensions
Add-Type -ReferencedAssemblies System.Speech,System.Web.Extensions -TypeDefinition @'
using System;
using System.Globalization;
using System.Speech.Recognition;
using System.Threading;
using System.Threading.Tasks;
using System.Web.Script.Serialization;
public class TlcVoiceConfiguration { public string[] hints; public string waveFile; }
public static class TlcOfflineVoice {
    static readonly object gate = new object();
    static readonly JavaScriptSerializer json = new JavaScriptSerializer();
    static int sequence = 0, segment = 0;
    static void Send(object message) { lock (gate) { Console.WriteLine(json.Serialize(message)); Console.Out.Flush(); } }
    static void Text(string text, bool final) {
        lock (gate) {
            Send(new { contractVersion = "1.0", type = "segment",
                segment = new { id = segment.ToString(), sequence = ++sequence, text = text, isFinal = final } });
            if (final) segment++;
        }
    }
    public static void Run() {
        try {
            var configuration = json.Deserialize<TlcVoiceConfiguration>(Console.ReadLine());
            using (var recognizer = new SpeechRecognitionEngine(new CultureInfo("en-US")))
            using (var done = new ManualResetEvent(false)) {
                recognizer.LoadGrammar(new DictationGrammar());
                if (configuration.hints != null && configuration.hints.Length > 0) {
                    var choices = new Choices(configuration.hints);
                    var builder = new GrammarBuilder(choices) { Culture = new CultureInfo("en-US") };
                    recognizer.LoadGrammar(new Grammar(builder) { Weight = 1.0f, Priority = 1 });
                }
                recognizer.InitialSilenceTimeout = TimeSpan.FromSeconds(10);
                recognizer.BabbleTimeout = TimeSpan.FromSeconds(10);
                recognizer.SpeechHypothesized += (s, e) => Text(e.Result.Text, false);
                recognizer.SpeechRecognized += (s, e) => Text(e.Result.Text, true);
                recognizer.RecognizeCompleted += (s, e) => {
                    if (e.Error != null) Send(new { contractVersion = "1.0", type = "error", code = "device-lost",
                        message = "The microphone or offline speech engine became unavailable." });
                    else Send(new { contractVersion = "1.0", type = "ended" });
                    done.Set();
                };
                if (String.IsNullOrEmpty(configuration.waveFile)) recognizer.SetInputToDefaultAudioDevice();
                else recognizer.SetInputToWaveFile(configuration.waveFile);
                recognizer.RecognizeAsync(RecognizeMode.Multiple);
                Send(new { contractVersion = "1.0", type = "started" });
                Task.Run(() => {
                    string command;
                    while (!done.WaitOne(0) && (command = Console.ReadLine()) != null) {
                        try {
                            if (command == "stop") { recognizer.RecognizeAsyncStop(); return; }
                        } catch (InvalidOperationException) { return; }
                    }
                });
                if (!done.WaitOne(TimeSpan.FromSeconds(30))) {
                    recognizer.RecognizeAsyncStop();
                    if (!done.WaitOne(TimeSpan.FromSeconds(1))) recognizer.RecognizeAsyncCancel();
                }
            }
        } catch (UnauthorizedAccessException) {
            Send(new { contractVersion = "1.0", type = "error", code = "permission-denied",
                message = "Microphone access was denied. Check Windows microphone privacy settings." });
        } catch (Exception) {
            Send(new { contractVersion = "1.0", type = "error", code = "provider-error",
                message = "Offline speech could not start. Check the microphone and installed English speech language." });
        }
    }
}
'@
[TlcOfflineVoice]::Run()
`

export class WindowsVoiceCaptureDriver implements VoiceCaptureDriver {
    private availability: Promise<VoiceAvailability> | undefined

    constructor(private readonly options: { remote?: boolean; inputFile?: string } = {}) { }

    getAvailability(): Promise<VoiceAvailability> | VoiceAvailability {
        if (this.options.remote) return {
            available: false, reason: 'remote-host',
            message: 'Voice capture is disabled in remote VS Code windows to protect the local microphone boundary.'
        }
        if (process.platform !== 'win32' || !process.env['SystemRoot']) return {
            available: false, reason: 'unsupported-platform',
            message: 'Desktop and VS Code voice require local Windows and an installed English (United States) speech language.'
        }
        this.availability ??= this.probe()
        return this.availability
    }

    private launch(program: string): ChildProcessWithoutNullStreams {
        const systemRoot = process.env['SystemRoot']
        if (!systemRoot) throw new Error('The Windows system directory is unavailable.')
        return spawn(join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'), [
            '-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(program, 'utf16le').toString('base64')
        ], {
            windowsHide: true, shell: false,
            env: { ...process.env, PSModulePath: join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'Modules') }
        })
    }

    private probe(): Promise<VoiceAvailability> {
        return new Promise((resolve) => {
            const child = this.launch(String.raw`
try {
    Add-Type -AssemblyName System.Speech
    $installed = @([System.Speech.Recognition.SpeechRecognitionEngine]::InstalledRecognizers() | Where-Object { $_.Culture.Name -eq 'en-US' })
    if ($installed.Count -gt 0) { Write-Output '{"available":true,"processing":"on-device","engine":"windows-offline"}' }
    else { Write-Output '{"available":false,"reason":"missing-language","message":"Install English (United States) speech recognition in Windows language settings."}' }
} catch { Write-Output '{"available":false,"reason":"not-configured","message":"The Windows offline speech engine is unavailable."}' }
`)
            let output = ''
            let settled = false
            const finish = (availability: VoiceAvailability) => {
                if (settled) return
                settled = true
                clearTimeout(timeout)
                child.kill()
                resolve(availability)
            }
            const unavailable: VoiceAvailability = {
                available: false, reason: 'not-configured',
                message: 'The Windows offline speech engine could not be checked.'
            }
            const timeout = setTimeout(() => finish(unavailable), 10_000)
            child.stdout.on('data', (chunk: Buffer) => {
                output += chunk.toString('utf8')
                if (output.length > 4_096) finish(unavailable)
            })
            child.once('error', () => finish(unavailable))
            child.once('close', () => {
                try {
                    finish(voiceAvailabilitySchema.parse(JSON.parse(output.trim())))
                } catch { finish(unavailable) }
            })
        })
    }

    start(request: VoiceStartRequest, onEvent: (event: VoiceSourceEvent) => void): VoiceCaptureHandle {
        if (this.options.remote || process.platform !== 'win32') {
            throw new Error('Offline native voice capture requires a local Windows host.')
        }
        const child = this.launch(speechProgram)
        child.stderr.resume()
        let disposed = false
        let ended = false
        let pending = ''
        const dispose = () => {
            if (disposed) return
            disposed = true
            child.kill()
        }
        const fail = () => {
            if (disposed || ended) return
            ended = true
            onEvent({
                contractVersion: voiceContractVersion, type: 'error', code: 'provider-error',
                message: 'The Windows offline speech process failed.'
            })
            dispose()
        }
        child.stdout.on('data', (chunk: Buffer) => {
            if (disposed) return
            pending += chunk.toString('utf8')
            if (pending.length > 65_536) { fail(); return }
            let newline: number
            while ((newline = pending.indexOf('\n')) >= 0) {
                const line = pending.slice(0, newline).trim()
                pending = pending.slice(newline + 1)
                if (!line) continue
                let event: VoiceSourceEvent
                try { event = voiceSourceEventSchema.parse(JSON.parse(line)) } catch { fail(); return }
                if (event.type === 'ended' || event.type === 'error') ended = true
                onEvent(event)
            }
        })
        child.once('error', fail)
        child.stdin.on('error', fail)
        child.once('close', () => {
            if (!disposed && !ended) fail()
        })
        child.stdin.write(`${JSON.stringify({
            hints: request.hints,
            ...(this.options.inputFile ? { waveFile: this.options.inputFile } : {})
        })}\n`)
        return {
            stop: () => { if (!disposed && !ended) child.stdin.write('stop\n') },
            dispose
        }
    }
}
