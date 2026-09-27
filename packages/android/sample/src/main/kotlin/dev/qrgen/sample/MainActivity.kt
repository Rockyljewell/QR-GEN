package dev.qrgen.sample

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.FilterChip
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import dev.qrgen.Barcode
import dev.qrgen.ScannerOptions
import dev.qrgen.android.QRGen
import dev.qrgen.compose.QRGenDefaults
import dev.qrgen.compose.QRGenScanner
import dev.qrgen.compose.rememberQRGenScannerState

/** Minimal QRGen demo: permission request, live scanning in three modes, torch, parsed result. */
class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        setContent {
            MaterialTheme(colorScheme = darkColorScheme(primary = QRGenDefaults.AccentColor)) {
                ScannerScreen()
            }
        }
    }
}

@Composable
private fun ScannerScreen() {
    val context = LocalContext.current
    var granted by remember { mutableStateOf(QRGen.hasCameraPermission(context)) }
    val permission = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted = it }
    LaunchedEffect(Unit) { if (!granted) permission.launch(QRGen.CAMERA_PERMISSION) }

    var mode by remember { mutableStateOf(ScannerOptions.Mode.CONTINUOUS) }
    var last by remember { mutableStateOf<Barcode?>(null) }
    var trackedCount by remember { mutableIntStateOf(0) }
    var error by remember { mutableStateOf<String?>(null) }
    val scanner = rememberQRGenScannerState()

    Box(Modifier.fillMaxSize()) {
        if (granted) {
            QRGenScanner(
                options = ScannerOptions(mode = mode),
                onScan = { barcodes ->
                    last = barcodes.first()
                    error = null
                },
                onError = { e -> error = "${e.code.id}: ${e.message}" },
                modifier = Modifier.fillMaxSize(),
                onTrack = { tracked -> trackedCount = tracked.size },
                state = scanner,
            )
        } else {
            Column(
                Modifier.align(Alignment.Center).padding(24.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                Text("QRGen needs the camera to scan codes.", color = Color.White)
                Button(onClick = { permission.launch(QRGen.CAMERA_PERMISSION) }) { Text("Allow camera") }
            }
        }

        Column(
            Modifier.align(Alignment.BottomCenter).fillMaxWidth().safeDrawingPadding().padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                for (m in ScannerOptions.Mode.entries) {
                    FilterChip(selected = mode == m, onClick = { mode = m; scanner.resume() }, label = { Text(m.id) })
                }
                TextButton(onClick = { scanner.setTorch(!scanner.isTorchOn) }) {
                    Text(if (scanner.isTorchOn) "Torch off" else "Torch on")
                }
            }
            if (mode == ScannerOptions.Mode.SINGLE && last != null) {
                Button(onClick = { scanner.resume() }) { Text("Scan again") }
            }
            error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
            last?.let { b -> ResultCard(b, if (mode == ScannerOptions.Mode.BATCH) trackedCount else null) }
        }
    }
}

@Composable
private fun ResultCard(barcode: Barcode, tracked: Int?) {
    val parsed = remember(barcode) { barcode.parse() }
    Card(Modifier.fillMaxWidth()) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Text("${barcode.symbologyName} · ${parsed.type}", style = MaterialTheme.typography.labelLarge)
            Text(barcode.data, style = MaterialTheme.typography.bodyLarge, maxLines = 3, overflow = TextOverflow.Ellipsis)
            if (tracked != null) Text("$tracked codes in view", style = MaterialTheme.typography.bodySmall)
        }
    }
}
