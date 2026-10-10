[CmdletBinding()]
param(
    [string]$OutputDirectory,
    [switch]$Recognize,
    [ValidateRange(0.0, 1.0)]
    [double]$MinimumWordAccuracy = 0.75
)

$ErrorActionPreference = 'Stop'
if ([string]::IsNullOrWhiteSpace($OutputDirectory)) {
    $OutputDirectory = Join-Path $PSScriptRoot '..\tests\fixtures\voice-input\recordings'
}
Add-Type -AssemblyName System.Speech

function Get-WordAccuracy([string]$Expected, [string]$Actual) {
    $expectedWords = @((($Expected.ToLowerInvariant() -replace '[^a-z0-9 ]', '') -split '\s+') | Where-Object { $_ })
    $actualWords = @((($Actual.ToLowerInvariant() -replace '[^a-z0-9 ]', '') -split '\s+') | Where-Object { $_ })
    if ($expectedWords.Count -eq 0) { throw 'A voice fixture must contain English words.' }
    $distance = [int[,]]::new(($expectedWords.Count + 1), ($actualWords.Count + 1))
    for ($i = 0; $i -le $expectedWords.Count; $i++) { $distance[$i, 0] = $i }
    for ($j = 0; $j -le $actualWords.Count; $j++) { $distance[0, $j] = $j }
    for ($i = 1; $i -le $expectedWords.Count; $i++) {
        for ($j = 1; $j -le $actualWords.Count; $j++) {
            $cost = if ($expectedWords[$i - 1] -eq $actualWords[$j - 1]) { 0 } else { 1 }
            $previousI = $i - 1
            $previousJ = $j - 1
            $deletion = $distance[$previousI, $j] + 1
            $insertion = $distance[$i, $previousJ] + 1
            $substitution = $distance[$previousI, $previousJ] + $cost
            $distance[$i, $j] = [Math]::Min([Math]::Min($deletion, $insertion), $substitution)
        }
    }
    $wordErrorRate = $distance[$expectedWords.Count, $actualWords.Count] / $expectedWords.Count
    return [Math]::Max(0.0, (1.0 - $wordErrorRate))
}

$manifestPath = Join-Path $PSScriptRoot '..\tests\fixtures\voice-input\statements.json'
$statements = Get-Content -Raw -LiteralPath $manifestPath | ConvertFrom-Json
if ($statements.Count -eq 0) { throw 'The voice fixture manifest is empty.' }
$outputPath = [System.IO.Path]::GetFullPath($OutputDirectory)
[System.IO.Directory]::CreateDirectory($outputPath) | Out-Null
$results = @()

$recognizerInfo = if ($Recognize) {
    [System.Speech.Recognition.SpeechRecognitionEngine]::InstalledRecognizers() |
        Where-Object { $_.Culture.Name -eq 'en-US' } | Select-Object -First 1
} else { $null }
if ($Recognize -and -not $recognizerInfo) {
    throw 'An English (United States) offline Windows speech recognizer is required.'
}

foreach ($statement in $statements) {
    if ($statement.id -notmatch '^[a-z][a-z0-9-]{0,63}$' -or
        $statement.text -isnot [string] -or
        [string]::IsNullOrWhiteSpace($statement.text) -or
        $statement.text.Length -gt 200) {
        throw 'Invalid sanitized voice fixture manifest entry.'
    }
    $wavPath = Join-Path $outputPath "$($statement.id).wav"
    $synthesizer = New-Object System.Speech.Synthesis.SpeechSynthesizer
    try {
        $synthesizer.SelectVoiceByHints(
            [System.Speech.Synthesis.VoiceGender]::NotSet,
            [System.Speech.Synthesis.VoiceAge]::NotSet,
            0,
            [System.Globalization.CultureInfo]::GetCultureInfo('en-US')
        )
        $synthesizer.Rate = -1
        $format = New-Object System.Speech.AudioFormat.SpeechAudioFormatInfo(
            16000,
            [System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen,
            [System.Speech.AudioFormat.AudioChannel]::Mono
        )
        $synthesizer.SetOutputToWaveFile($wavPath, $format)
        $synthesizer.Speak($statement.text)
    } finally {
        $synthesizer.Dispose()
    }

    $hasher = [System.Security.Cryptography.SHA256]::Create()
    try {
        $hash = $hasher.ComputeHash([System.IO.File]::ReadAllBytes($wavPath))
        $sha256 = [System.BitConverter]::ToString($hash).Replace('-', '').ToLowerInvariant()
    } finally {
        $hasher.Dispose()
    }
    $entry = [ordered]@{
        id = $statement.id
        expectedText = $statement.text
        fileName = "$($statement.id).wav"
        sampleRate = 16000
        bitsPerSample = 16
        channels = 1
        bytes = (Get-Item -LiteralPath $wavPath).Length
        sha256 = $sha256
    }
    if ($Recognize) {
        $recognizer = New-Object System.Speech.Recognition.SpeechRecognitionEngine($recognizerInfo)
        try {
            $recognizer.LoadGrammar((New-Object System.Speech.Recognition.DictationGrammar))
            $recognizer.SetInputToWaveFile($wavPath)
            $fragments = @()
            $confidence = @()
            while ($null -ne ($result = $recognizer.Recognize())) {
                $fragments += $result.Text
                $confidence += [double]$result.Confidence
            }
            $recognizedText = $fragments -join ' '
            $entry.recognizedText = $recognizedText
            $entry.confidence = $confidence
            $entry.wordAccuracy = Get-WordAccuracy $statement.text $recognizedText
            $entry.passed = $entry.wordAccuracy -ge $MinimumWordAccuracy
        } finally {
            $recognizer.Dispose()
        }
    }
    $results += [pscustomobject]$entry
}

$reportPath = Join-Path $outputPath 'results.json'
ConvertTo-Json -InputObject $results -Depth 5 |
    Set-Content -LiteralPath $reportPath -Encoding UTF8
Write-Output "Created $($results.Count) synthetic 16 kHz mono recordings in $outputPath."
if ($Recognize) {
    $failures = @($results | Where-Object { -not $_.passed })
    Write-Output "Offline dictation qualification: $($results.Count - $failures.Count)/$($results.Count) meet word accuracy >= $MinimumWordAccuracy."
    if ($failures.Count -gt 0) {
        throw "Offline dictation qualification failed for $($failures.Count) synthetic statements. Actual results are in $reportPath."
    }
}
