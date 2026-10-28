Add-Type -AssemblyName System.Drawing
$base = Join-Path $PSScriptRoot 'assets'

function New-RoundPath([single]$x, [single]$y, [single]$w, [single]$h, [single]$r) {
  $path = New-Object System.Drawing.Drawing2D.GraphicsPath
  $d = $r * 2
  $path.AddArc($x, $y, $d, $d, 180, 90)
  $path.AddArc(($x + $w - $d), $y, $d, $d, 270, 90)
  $path.AddArc(($x + $w - $d), ($y + $h - $d), $d, $d, 0, 90)
  $path.AddArc($x, ($y + $h - $d), $d, $d, 90, 90)
  $path.CloseFigure()
  return $path
}

function New-IconPng([int]$size) {
  $bitmap = New-Object System.Drawing.Bitmap(
    $size, $size, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb
  )
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $graphics.ScaleTransform(($size / 256.0), ($size / 256.0))

  $outer = New-RoundPath 24 22 208 212 43
  $outerBrush = New-Object System.Drawing.Drawing2D.LinearGradientBrush `
    ([System.Drawing.RectangleF]::new(24, 22, 208, 212)), `
    ([System.Drawing.Color]::FromArgb(255, 20, 44, 99)), `
    ([System.Drawing.Color]::FromArgb(255, 73, 26, 104)), 45
  $graphics.FillPath($outerBrush, $outer)
  $graphics.DrawPath((New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(255, 91, 206, 255)), 5), $outer)

  $inner = New-RoundPath 38 36 180 184 31
  $graphics.FillPath(
    (New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, 14, 28, 65))),
    $inner
  )
  $graphics.DrawPath(
    (New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(210, 105, 139, 255)), 2),
    $inner
  )
  $graphics.DrawLine(
    (New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(115, 89, 174, 255)), 2),
    48, 67, 208, 67
  )

  $outline = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(255, 67, 218, 255)), 3
  $outline.LineJoin = [System.Drawing.Drawing2D.LineJoin]::Round
  foreach ($box in @(@(53, 82, 34, 34), @(53, 137, 34, 34), @(53, 192, 34, 22))) {
    $path = New-RoundPath $box[0] $box[1] $box[2] $box[3] 8
    $graphics.FillPath(
      (New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, 22, 47, 103))),
      $path
    )
    $graphics.DrawPath($outline, $path)
    $path.Dispose()
  }

  $check = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(255, 255, 139, 244)), 5
  $check.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
  $check.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
  $check.LineJoin = [System.Drawing.Drawing2D.LineJoin]::Round
  $graphics.DrawLines($check, [System.Drawing.Point[]]@(
    [System.Drawing.Point]::new(61, 98), [System.Drawing.Point]::new(68, 105), [System.Drawing.Point]::new(81, 90)
  ))
  $graphics.DrawLines($check, [System.Drawing.Point[]]@(
    [System.Drawing.Point]::new(61, 153), [System.Drawing.Point]::new(68, 160), [System.Drawing.Point]::new(81, 145)
  ))
  $graphics.DrawLines($check, [System.Drawing.Point[]]@(
    [System.Drawing.Point]::new(61, 201), [System.Drawing.Point]::new(67, 207), [System.Drawing.Point]::new(79, 195)
  ))

  foreach ($line in @(
    @{ Color = [System.Drawing.Color]::FromArgb(255, 58, 224, 255); X1 = 105; Y1 = 91; X2 = 196; Y2 = 91; Width = 5 },
    @{ Color = [System.Drawing.Color]::FromArgb(255, 72, 103, 174); X1 = 105; Y1 = 105; X2 = 175; Y2 = 105; Width = 3 },
    @{ Color = [System.Drawing.Color]::FromArgb(255, 169, 89, 255); X1 = 105; Y1 = 146; X2 = 196; Y2 = 146; Width = 5 },
    @{ Color = [System.Drawing.Color]::FromArgb(255, 72, 103, 174); X1 = 105; Y1 = 160; X2 = 175; Y2 = 160; Width = 3 },
    @{ Color = [System.Drawing.Color]::FromArgb(255, 255, 112, 218); X1 = 105; Y1 = 199; X2 = 182; Y2 = 199; Width = 5 }
  )) {
    $pen = New-Object System.Drawing.Pen $line.Color, $line.Width
    $pen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
    $pen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
    $graphics.DrawLine($pen, $line.X1, $line.Y1, $line.X2, $line.Y2)
    $pen.Dispose()
  }

  $stream = New-Object System.IO.MemoryStream
  $bitmap.Save($stream, [System.Drawing.Imaging.ImageFormat]::Png)
  $png = $stream.ToArray()
  $graphics.Dispose()
  $bitmap.Dispose()
  $stream.Dispose()
  $outer.Dispose()
  $outerBrush.Dispose()
  $inner.Dispose()
  $outline.Dispose()
  $check.Dispose()
  return ,$png
}

[System.IO.File]::WriteAllBytes((Join-Path $base 'app-icon.png'), (New-IconPng 256))
[System.IO.File]::WriteAllBytes((Join-Path $base 'tray-icon.png'), (New-IconPng 32))

$sizes = @(16, 32, 48, 64, 128, 256)
$frames = @()
foreach ($size in $sizes) { $frames += ,(New-IconPng $size) }
$stream = New-Object System.IO.MemoryStream
$writer = New-Object System.IO.BinaryWriter($stream)
$writer.Write([UInt16]0)
$writer.Write([UInt16]1)
$writer.Write([UInt16]$sizes.Count)
$offset = 6 + 16 * $sizes.Count
for ($i = 0; $i -lt $sizes.Count; $i++) {
  $dimension = if ($sizes[$i] -eq 256) { [byte]0 } else { [byte]$sizes[$i] }
  $writer.Write($dimension)
  $writer.Write($dimension)
  $writer.Write([byte]0)
  $writer.Write([byte]0)
  $writer.Write([UInt16]1)
  $writer.Write([UInt16]32)
  $writer.Write([UInt32]$frames[$i].Length)
  $writer.Write([UInt32]$offset)
  $offset += $frames[$i].Length
}
foreach ($frame in $frames) { $writer.Write($frame) }
[System.IO.File]::WriteAllBytes((Join-Path $base 'app-icon.ico'), $stream.ToArray())
$writer.Dispose()
$stream.Dispose()
