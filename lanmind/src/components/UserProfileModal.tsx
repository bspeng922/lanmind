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
    <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-md w-full p-6 space-y-5 shadow-2xl animate-in fade-in zoom-in-95 duration-150">
        <div className="flex items-center justify-between pb-3 border-b border-slate-800">
          <div className="flex items-center space-x-2 text-blue-400">
            <UserCheck className="w-5 h-5" />
            <h2 className="text-sm font-bold text-white">个人节点资料设置 (Profile)</h2>
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
        <div className="bg-slate-950 border border-slate-800 p-4 rounded-xl flex items-center space-x-4">
          <div className="w-14 h-14 rounded-2xl bg-gradient-to-tr from-blue-600/30 to-indigo-600/30 border border-blue-500/40 flex items-center justify-center text-3xl shadow-inner flex-shrink-0 overflow-hidden">
            {isImageAvatar ? (
              <img src={currentDisplayAvatar} alt="Avatar Preview" className="w-full h-full object-cover" />
            ) : (
              currentDisplayAvatar || '👤'
            )}
          </div>
          <div className="min-w-0 flex-1 text-xs">
            <div className="font-bold text-white text-sm truncate">{nickname || currentUser.nickname}</div>
            <div className="text-slate-400 font-mono mt-0.5 truncate">{currentUser.id}</div>
            <div className="flex items-center space-x-2 mt-1 text-[10px] text-slate-500">
              <span className="bg-slate-800 px-1.5 py-0.5 rounded text-emerald-400 font-mono">IP: {currentUser.ip}</span>
              <span className="bg-indigo-500/20 text-indigo-300 px-1.5 py-0.5 rounded font-mono uppercase">
                {currentUser.role}
              </span>
            </div>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4 text-xs">
          {/* Avatar Selector */}
          <div>
            <label className="block text-slate-400 font-semibold mb-2 flex items-center gap-1.5">
              <Smile className="w-4 h-4 text-amber-400" /> <span>头像标识（支持表情与自定义图片）</span>
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
                className="flex-1 bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 px-3 py-2 rounded-xl flex items-center justify-center gap-2 font-medium transition-colors"
              >
                <Upload className="w-4 h-4 text-blue-400" />
                <span>{uploadedImage ? '重新选择图片头像' : '上传本地图片作为头像'}</span>
              </button>

              {uploadedImage && (
                <button
                  type="button"
                  onClick={() => {
                    setUploadedImage(null);
                    setAvatar('👨‍💻');
                  }}
                  className="px-2.5 py-2 bg-rose-950/40 text-rose-300 border border-rose-500/30 rounded-xl hover:bg-rose-900/60"
                  title="清除图片头像"
                >
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>

            <div className="grid grid-cols-8 gap-2 bg-slate-950 p-2.5 rounded-xl border border-slate-800">
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
                      ? 'bg-blue-600 text-white scale-110 shadow-lg shadow-blue-600/40 ring-2 ring-blue-400'
                      : 'bg-slate-900 hover:bg-slate-800 text-slate-300'
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
                className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-1.5 text-slate-200 placeholder-slate-500 focus:outline-none focus:border-blue-500 text-xs"
              />
            </div>
          </div>

          {/* Nickname Input */}
          <div>
            <label className="mb-1 flex items-center gap-1.5 font-semibold text-slate-400">
              <UserRound className="h-3.5 w-3.5 text-blue-400" />
              <span>局域网昵称 <span className="text-rose-400">*</span></span>
            </label>
            <input
              type="text"
              required
              value={nickname}
              onChange={(e) => setNickname(e.target.value)}
              placeholder="请输入节点显示名称..."
              className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-slate-100 font-medium focus:outline-none focus:border-blue-500"
            />
          </div>

          {success && (
            <div className="p-2.5 bg-emerald-950/40 border border-emerald-500/40 text-emerald-300 rounded-xl flex items-center gap-2 font-medium">
              <Check className="w-4 h-4 text-emerald-400" />
              <span>节点资料更新成功！</span>
            </div>
          )}

          <div className="flex items-center justify-end space-x-2 pt-2 border-t border-slate-800">
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
              className="theme-btn-primary px-5 py-2 font-bold rounded-xl shadow-lg flex items-center gap-1.5"
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
