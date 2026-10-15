# Prints pixel colours at given x,y points of an image. Usage: -Img path -Pts "x,y x,y ..."
param([string]$Img, [string]$Pts)
Add-Type -AssemblyName System.Drawing
$b = [System.Drawing.Bitmap]::FromFile($Img)
foreach ($p in $Pts -split ' ') {
  $x, $y = $p -split ','
  $c = $b.GetPixel([int]$x, [int]$y)
  "{0},{1} #{2:x2}{3:x2}{4:x2}" -f $x, $y, $c.R, $c.G, $c.B
}
$b.Dispose()
