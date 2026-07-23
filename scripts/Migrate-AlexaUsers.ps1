param(
    [switch]$Apply
)

$ErrorActionPreference = "Stop"

function Get-RequiredEnvironmentVariable([string]$Name) {
    $value = [Environment]::GetEnvironmentVariable($Name)

    if ([string]::IsNullOrWhiteSpace($value)) {
        throw "Falta la variable de entorno requerida $Name."
    }

    return $value
}

function Get-FirebaseIdToken {
    $apiKey = Get-RequiredEnvironmentVariable "VOICE_MESSAGING_FIREBASE_API_KEY"
    $body = @{
        email = Get-RequiredEnvironmentVariable "VOICE_MESSAGING_FIREBASE_EMAIL"
        password = Get-RequiredEnvironmentVariable "VOICE_MESSAGING_FIREBASE_PASSWORD"
        returnSecureToken = $true
    } | ConvertTo-Json

    $response = Invoke-RestMethod `
        -Method Post `
        -Uri "https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=$([Uri]::EscapeDataString($apiKey))" `
        -ContentType "application/json" `
        -Body $body

    return $response.idToken
}

function Invoke-FirebaseRequest([string]$Method, [string]$Path, $Body = $null) {
    $uri = "$script:FirebaseUrl/$Path.json?auth=$([Uri]::EscapeDataString($script:IdToken))"
    $parameters = @{
        Method = $Method
        Uri = $uri
    }

    if ($null -ne $Body) {
        $parameters.ContentType = "application/json"
        $parameters.Body = $Body | ConvertTo-Json -Depth 20 -Compress
    }

    return Invoke-RestMethod @parameters
}

$script:FirebaseUrl = (Get-RequiredEnvironmentVariable "VOICE_MESSAGING_FIREBASE_URL").TrimEnd("/")
$script:IdToken = Get-FirebaseIdToken
$legacyUsers = Invoke-FirebaseRequest "Get" "usuarios_alexa"
$users = Invoke-FirebaseRequest "Get" "usuarios"
$updates = [ordered]@{}
$phoneAssignments = @{}
$copied = 0
$alreadyMigrated = 0
$invalid = 0
$conflicts = 0
$relocatedFromConfig = 0

if ($null -ne $legacyUsers) {
    foreach ($property in $legacyUsers.PSObject.Properties) {
        $alexaIdHash = $property.Name
        $legacyRecord = $property.Value
        $phone = [regex]::Replace([string]$legacyRecord.Phone, "\D", "")

        if ([string]::IsNullOrWhiteSpace($phone)) {
            Write-Warning "Registro $alexaIdHash omitido: teléfono vacío o inválido."
            $invalid++
            continue
        }

        $existingHash = $null
        $userProperty = if ($null -eq $users) { $null } else { $users.PSObject.Properties[$phone] }

        if ($null -ne $userProperty -and $null -ne $userProperty.Value.configuracion) {
            $existingHash = [string]$userProperty.Value.configuracion.id_alexa_hash
        }

        if (-not [string]::IsNullOrWhiteSpace($existingHash) -and $existingHash -ne $alexaIdHash) {
            Write-Warning "Conflicto para el teléfono $phone`: ya contiene otro hash de Alexa."
            $conflicts++
            continue
        }

        if ($phoneAssignments.ContainsKey($phone) -and $phoneAssignments[$phone] -ne $alexaIdHash) {
            Write-Warning "Conflicto para el teléfono $phone`: hay más de un hash en /usuarios_alexa."
            $conflicts++
            continue
        }

        if ($existingHash -eq $alexaIdHash) {
            $alreadyMigrated++
            continue
        }

        $phoneAssignments[$phone] = $alexaIdHash
        $updates["usuarios/$phone/configuracion/id_alexa_hash"] = $alexaIdHash
        $updatedAt = if ($null -eq $legacyRecord.UpdatedAt) { [DateTime]::UtcNow.ToString("o") } else { $legacyRecord.UpdatedAt }
        $updates["usuarios/$phone/configuracion/alexa_actualizado_en"] = $updatedAt
        $copied++
    }
}

if ($null -ne $users) {
    foreach ($userProperty in $users.PSObject.Properties) {
        $phone = $userProperty.Name
        $oldConfig = $userProperty.Value.config
        $oldHash = if ($null -eq $oldConfig) { "" } else { [string]$oldConfig.id_alexa_hash }

        if ([string]::IsNullOrWhiteSpace($oldHash)) {
            continue
        }

        $canonicalHash = if ($null -eq $userProperty.Value.configuracion) { "" } else { [string]$userProperty.Value.configuracion.id_alexa_hash }

        if (-not [string]::IsNullOrWhiteSpace($canonicalHash) -and $canonicalHash -ne $oldHash) {
            Write-Warning "Conflicto para el teléfono $phone`: config y configuracion contienen hashes diferentes."
            $conflicts++
            continue
        }

        $updates["usuarios/$phone/configuracion/id_alexa_hash"] = $oldHash
        $oldUpdatedAt = $oldConfig.alexa_actualizado_en

        if ($null -ne $oldUpdatedAt) {
            $updates["usuarios/$phone/configuracion/alexa_actualizado_en"] = $oldUpdatedAt
        }

        $updates["usuarios/$phone/config/id_alexa_hash"] = $null
        $updates["usuarios/$phone/config/alexa_actualizado_en"] = $null
        $relocatedFromConfig++
    }
}

Write-Host ""
Write-Host "Resumen de migración"
Write-Host "  Preparados para copiar: $copied"
Write-Host "  Ya migrados:          $alreadyMigrated"
Write-Host "  Inválidos:             $invalid"
Write-Host "  Conflictos:            $conflicts"
Write-Host "  Movidos desde config:  $relocatedFromConfig"

if (-not $Apply) {
    Write-Host ""
    Write-Host "Vista previa terminada. No se modificó Firebase."
    Write-Host "Ejecuta nuevamente con -Apply para copiar los registros válidos."
    exit 0
}

if ($updates.Count -eq 0) {
    Write-Host "No hay cambios para aplicar."
    exit 0
}

Invoke-FirebaseRequest "Patch" "" $updates | Out-Null
Write-Host "Migración aplicada. /usuarios_alexa no fue modificado ni eliminado."
