"""Generate original Super Content raster marks with Python's standard library."""
import struct
import zlib
from pathlib import Path


def chunk(kind, data):
    return struct.pack('!I', len(data)) + kind + data + struct.pack('!I', zlib.crc32(kind + data))


for size, name in [(192, 'icon-192'), (512, 'icon-512'), (180, 'apple-touch-icon')]:
    rows = []
    for y in range(size):
        row = bytearray()
        for x in range(size):
            a, b = x / size, y / size
            color = (15, 18, 22)
            if .19 < a < .81 and .25 < b < .75:
                color = (255, 122, 26)
            if .435 < a < .62 and abs(b - .5) < (.62 - a) * .65:
                color = (15, 18, 22)
            row.extend(color)
        rows.append(b'\x00' + row)
    Path(f'public/icons/{name}.png').write_bytes(
        b'\x89PNG\r\n\x1a\n'
        + chunk(b'IHDR', struct.pack('!2I5B', size, size, 8, 2, 0, 0, 0))
        + chunk(b'IDAT', zlib.compress(b''.join(rows)))
        + chunk(b'IEND', b'')
    )
