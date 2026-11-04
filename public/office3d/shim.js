// Engine my-office gọi nhiều /api/* của riêng nó (Mac, vault, burn, chat…) mà Agent Office không có: trả JSON rỗng thay vì lỗi 404.
// Chặn luôn việc gọi dịch vụ ngoài (thời tiết) để trang không gửi gì ra khỏi máy.
(() => {
  const real = window.fetch.bind(window);
  const empty = () => new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
  window.fetch = (input, init) => {
    const url = typeof input === 'string' ? input : input?.url || '';
    if (/^https?:\/\//.test(url) && !url.startsWith(location.origin)) return Promise.resolve(new Response('{}', { status: 503 }));
    if (url.startsWith('/api/') || url.startsWith('/hook/')) return Promise.resolve(empty());
    return real(input, init);
  };
  window.EventSource = class { constructor() { this.readyState = 2; } close() {} };   // (không có /stream)
})();
