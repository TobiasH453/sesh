export class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

async function request(method, path, body) {
  const res = await fetch(path, {
    method,
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : {},
    body: body !== undefined ? JSON.stringify(body) : undefined,
    credentials: 'same-origin',
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401 && !path.startsWith('/api/login') && !path.startsWith('/api/me')) {
      window.dispatchEvent(new Event('sesh:logout'));
    }
    throw new ApiError(res.status, data.error || `request failed (${res.status})`);
  }
  return data;
}

export const api = {
  get: (p) => request('GET', p),
  post: (p, body = {}) => request('POST', p, body),
  del: (p) => request('DELETE', p),

  // XHR for upload progress, which fetch still can't report.
  upload(method, path, blob, onProgress) {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open(method, path);
      xhr.setRequestHeader('Content-Type', blob.type);
      xhr.upload.onprogress = (e) => e.lengthComputable && onProgress?.(e.loaded / e.total);
      xhr.onload = () => {
        let data = {};
        try {
          data = JSON.parse(xhr.responseText);
        } catch {}
        if (xhr.status >= 200 && xhr.status < 300) resolve(data);
        else reject(new ApiError(xhr.status, data.error || `upload failed (${xhr.status})`));
      };
      xhr.onerror = () => reject(new ApiError(0, 'network error'));
      xhr.send(blob);
    });
  },
};
