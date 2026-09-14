import React, { useState, useEffect, useRef } from 'react';
import { User } from '../types';
import { ApiService } from '../services/api';
import { X, UserCheck, Sparkles, Check, Smile, HardDrive, Upload, Image as ImageIcon, UserRound } from 'lucide-react';

interface UserProfileModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentUser: User;
  onUserUpdated: (user: User) => void;
}

const AVATAR_PRESETS = [
  '👨‍💻', '👩‍💻', '🛡️', '🧠', '🎨', '🚀', '⚡', '⚙️',
  '🦉', '🦊', '🐯', '🐼', '🦁', '🐬', '💼', '🎯'
];

export const UserProfileModal: React.FC<UserProfileModalProps> = ({
  isOpen,
  onClose,
  currentUser,
  onUserUpdated,
}) => {
  const [nickname, setNickname] = useState(currentUser.nickname);
  const [avatar, setAvatar] = useState(currentUser.avatar || '👨‍💻');
  const [customAvatarInput, setCustomAvatarInput] = useState('');
  const [uploadedImage, setUploadedImage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen) {
      setNickname(currentUser.nickname);
      setAvatar(currentUser.avatar || '👨‍💻');
      setCustomAvatarInput('');
      setUploadedImage(currentUser.avatar && currentUser.avatar.startsWith('data:image') ? currentUser.avatar : null);
      setSuccess(false);
    }
  }, [isOpen, currentUser.id]);

  if (!isOpen) return null;

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 2 * 1024 * 1024) {
      alert('图片大小不能超过 2MB');
      return;
    }

    const reader = new FileReader();
    reader.onload = (event) => {
      const result = event.target?.result as string;
      if (result) {
        setUploadedImage(result);
        setAvatar(result);
        setCustomAvatarInput('');
      }
    };
    reader.readAsDataURL(file);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!nickname.trim()) return;

    setLoading(true);
    try {
      const finalAvatar = uploadedImage || customAvatarInput.trim() || avatar;
      const updatedUser = await ApiService.setIdentity({
        ...currentUser,
        nickname: nickname.trim(),
        avatar: finalAvatar,
      });
      setSuccess(true);
      onUserUpdated(updatedUser);
      setTimeout(() => {
        setSuccess(false);
        onClose();
      }, 800);
    } catch (err) {
      console.error('Failed to update user profile', err);
    } finally {
      setLoading(false);
    }
  };

  const currentDisplayAvatar = uploadedImage || customAvatarInput.trim() || avatar;
  const isImageAvatar = currentDisplayAvatar.startsWith('data:image') || currentDisplayAvatar.startsWith('http');

  return (
    <div className="fixed inset-0 bg-overlay backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-surface border border-edge rounded-2xl max-w-md w-full p-6 space-y-5 shadow-popover animate-in fade-in zoom-in-95 duration-150">
        <div className="flex items-center justify-between pb-3 border-b border-edge">
          <div className="flex items-center space-x-2 text-info">
            <UserCheck className="w-5 h-5" />
            <h2 className="text-sm font-bold text-main">个人节点资料设置 (Profile)</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="ui-modal-close-btn"
            title="关闭 (Esc)"
            aria-label="关闭"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* User Card Preview */}
        <div className="bg-canvas border border-edge p-4 rounded-xl flex items-center space-x-4">
          <div className="w-14 h-14 rounded-2xl bg-gradient-to-tr from-blue-600/30 to-indigo-600/30 border border-blue-500/40 flex items-center justify-center text-3xl shadow-inner flex-shrink-0 overflow-hidden">
            {isImageAvatar ? (
              <img src={currentDisplayAvatar} alt="Avatar Preview" className="w-full h-full object-cover" />
            ) : (
              currentDisplayAvatar || '👤'
            )}
          </div>
          <div className="min-w-0 flex-1 text-xs">
            <div className="font-bold text-main text-sm truncate">{nickname || currentUser.nickname}</div>
            <div className="text-sub font-mono mt-0.5 truncate">{currentUser.id}</div>
            <div className="flex items-center space-x-2 mt-1 text-[10px] text-quiet">
              <span className="bg-card px-1.5 py-0.5 rounded text-success font-mono">IP: {currentUser.ip}</span>
              <span className="bg-indigo-500/20 text-feature px-1.5 py-0.5 rounded font-mono uppercase">
                {currentUser.role}
              </span>
            </div>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4 text-xs">
          {/* Avatar Selector */}
          <div>
            <label className="block text-sub font-semibold mb-2 flex items-center gap-1.5">
              <Smile className="w-4 h-4 text-warning" /> <span>头像标识（支持表情与自定义图片）</span>
            </label>

            {/* Upload Local Image Button */}
            <div className="mb-3 flex items-center space-x-2">
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                onChange={handleImageUpload}
                className="hidden"
              />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="flex-1 bg-card hover:bg-hover border border-subtle text-main px-3 py-2 rounded-xl flex items-center justify-center gap-2 font-medium transition-colors"
              >
                <Upload className="w-4 h-4 text-info" />
                <span>{uploadedImage ? '重新选择图片头像' : '上传本地图片作为头像'}</span>
              </button>

              {uploadedImage && (
                <button
                  type="button"
                  onClick={() => {
                    setUploadedImage(null);
                    setAvatar('👨‍💻');
                  }}
                  className="px-2.5 py-2 bg-danger/10 text-danger border border-rose-500/30 rounded-xl hover:bg-danger/10"
                  title="清除图片头像"
                >
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>

            <div className="grid grid-cols-8 gap-2 bg-canvas p-2.5 rounded-xl border border-edge">
              {AVATAR_PRESETS.map((emoji) => (
                <button
                  type="button"
                  key={emoji}
                  onClick={() => {
                    setAvatar(emoji);
                    setCustomAvatarInput('');
                    setUploadedImage(null);
                  }}
                  className={`w-8 h-8 rounded-lg flex items-center justify-center text-lg transition-all ${
                    avatar === emoji && !customAvatarInput && !uploadedImage
                      ? 'bg-blue-600 text-on-solid scale-110 shadow-panel shadow-blue-600/40 ring-2 ring-blue-400'
                      : 'bg-surface hover:bg-hover text-sub'
                  }`}
                >
                  {emoji}
                </button>
              ))}
            </div>

            {/* Custom Avatar Input */}
            <div className="mt-2">
              <input
                type="text"
                value={customAvatarInput}
                onChange={(e) => {
                  setCustomAvatarInput(e.target.value);
                  setUploadedImage(null);
                }}
                placeholder="或粘贴图片 URL / Emoji..."
                className="w-full bg-canvas border border-subtle rounded-xl px-3 py-1.5 text-main placeholder-quiet focus:outline-none focus:border-accent/50 text-xs"
              />
            </div>
          </div>

          {/* Nickname Input */}
          <div>
            <label className="mb-1 flex items-center gap-1.5 font-semibold text-sub">
              <UserRound className="h-3.5 w-3.5 text-info" />
              <span>局域网昵称 <span className="text-danger">*</span></span>
            </label>
            <input
              type="text"
              required
              value={nickname}
              onChange={(e) => setNickname(e.target.value)}
              placeholder="请输入节点显示名称..."
              className="w-full bg-canvas border border-subtle rounded-xl px-3 py-2 text-main font-medium focus:outline-none focus:border-accent/50"
            />
          </div>

          {success && (
            <div className="p-2.5 bg-success/10 border border-emerald-500/40 text-success rounded-xl flex items-center gap-2 font-medium">
              <Check className="w-4 h-4 text-success" />
              <span>节点资料更新成功！</span>
            </div>
          )}

          <div className="flex items-center justify-end space-x-2 pt-2 border-t border-edge">
            <button
              type="button"
              onClick={onClose}
              className="ui-cancel-button px-4 py-2 rounded-xl font-semibold"
            >
              取消
            </button>
            <button
              type="submit"
              disabled={loading}
              className="theme-btn-primary px-5 py-2 font-bold rounded-xl shadow-panel flex items-center gap-1.5"
            >
              {loading ? (
                <span>保存中...</span>
              ) : (
                <>
                  <Check className="w-4 h-4" />
                  <span>保存个人资料</span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
