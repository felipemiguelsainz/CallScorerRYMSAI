/// <reference types="vitest" />
import { fireEvent, render, screen } from '@testing-library/react';
import AudioUploader from './AudioUploader';

vi.mock('../hooks/useEvaluation', () => ({
  useUploadAudio: () => ({
    mutate: vi.fn(),
    isPending: false,
    error: null,
  }),
}));

describe('AudioUploader', () => {
  it('rejects non-mp3 files in client validation', () => {
    const { container } = render(<AudioUploader evaluacionId="eval-1" />);
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;

    const txtFile = new File(['hello'], 'invalid.txt', { type: 'text/plain' });
    fireEvent.change(input, { target: { files: [txtFile] } });

    expect(screen.getByText('Solo se permiten archivos MP3 válidos.')).toBeInTheDocument();
  });

  it('rejects files larger than 25MB', () => {
    const { container } = render(<AudioUploader evaluacionId="eval-1" />);
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;

    const oversized = new File([new Uint8Array(25 * 1024 * 1024 + 1)], 'audio.mp3', {
      type: 'audio/mpeg',
    });
    fireEvent.change(input, { target: { files: [oversized] } });

    expect(screen.getByText('El archivo supera el máximo de 25MB.')).toBeInTheDocument();
  });
});
