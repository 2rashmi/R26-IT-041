function StatusMessage({ type, message }) {
  if (!message) return null;
  return <div className={`status-message ${type}`}>{message}</div>;
}

export default StatusMessage;
