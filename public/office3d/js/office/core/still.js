// Agent Office: văn phòng đứng yên. Agent ngồi tại bàn của mình (không đi lại, không có sinh hoạt phụ: nghỉ trưa, ra phố, giao hàng…),
// phố và thời tiết không chạy: tiết kiệm CPU/GPU. Thêm ?motion=1 vào địa chỉ để bật lại toàn bộ chuyển động như my-office.
export const STILL = !new URLSearchParams(location.search).has('motion');
