import React from 'react';
import { X, Sidebar, Pen, Columns2, Bookmark, PanelRight, Highlighter, ZoomIn, AlertCircle, BookOpen } from 'lucide-react';
import '../../css/help_modal.css';

interface HelpModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const HelpModal: React.FC<HelpModalProps> = ({ isOpen, onClose }) => {
  const features = [
    {
      icon: <Sidebar className="help_icon_blue" size={20} />,
      title: "목차 및 목록 확인",
      description: "왼쪽 상단의 메뉴 아이콘을 누르면 책의 전체 목차를 볼 수 있으며, 원하는 장으로 빠르게 이동할 수 있습니다."
    },
    {
      icon: <Highlighter className="help_icon_emerald" size={20} />,
      title: "텍스트 선택 및 강조",
      description: "본문의 글자를 길게 누르거나 드래그하여 선택하면, 형광펜으로 색을 칠하거나 중요한 내용을 강조할 수 있습니다."
    },
    {
      icon: <Pen className="help_icon_blue" size={20} />,
      title: "자유로운 직접 필기",
      description: "상단 중앙의 펜 도구를 선택해 중요한 내용에 직접 글씨를 쓰거나 그림을 그려 메모를 남길 수 있습니다."
    },
    {
      icon: <ZoomIn className="help_icon_rose" size={20} />,
      title: "편리한 화면 확대/축소",
      description: "PC에서는 [Ctrl + 휠]로, 태블릿에서는 펜이 활성화된 상태에서도 두 손가락 터치로 자유롭게 화면을 조절할 수 있습니다."
    },
    {
      icon: <Bookmark className="help_icon_amber" size={20} />,
      title: "중요 페이지 책갈피",
      description: "기억하고 싶은 페이지는 상단 중앙 오른쪽에 있는 책갈피 아이콘을 눌러 저장하고 나중에 다시 찾아볼 수 있습니다."
    },
    {
      icon: <PanelRight className="help_icon_purple" size={20} />,
      title: "나의 학습 도구함",
      description: "오른쪽 상단 끝의 패널 아이콘을 열면 내가 남긴 메모, 강조 표시, 저장한 내용들을 한곳에서 모아 관리할 수 있습니다."
    }
  ];

  if (!isOpen) return null;

  return (
    <div className="help_modal_overlay" onClick={onClose}>
      <div className="help_modal_container" onClick={(e) => e.stopPropagation()}>
        {/* 헤더 */}
        <div className="help_modal_header">
          <div className="help_modal_title_row">
            <div className="help_modal_icon_wrap">
              <BookOpen size={22} />
            </div>
            <div>
              <h2 className="help_modal_title">캠퍼스북 이용 가이드</h2>
              <p className="help_modal_subtitle">효율적인 학습을 위한 주요 기능과 주의사항을 확인하세요.</p>
            </div>
          </div>
          <button onClick={onClose} className="help_modal_close_btn" title="닫기">
            <X size={20} />
          </button>
        </div>

        {/* 본문 */}
        <div className="help_modal_body">
          <div className="help_features_grid">
            {features.map((feature, idx) => (
              <div key={idx} className="help_feature_item">
                <div className="help_feature_icon_box">
                  {feature.icon}
                </div>
                <div className="help_feature_text">
                  <h3 className="help_feature_title">{feature.title}</h3>
                  <p className="help_feature_desc">{feature.description}</p>
                </div>
              </div>
            ))}
          </div>

          {/* 이용 안내 */}
          <div className="help_notice_box">
            <h4 className="help_notice_title">
              <AlertCircle size={16} className="help_icon_blue" />
              기기 사양 및 이용 안내
            </h4>
            <ul className="help_notice_list">
              <li className="help_notice_item">
                <span className="help_notice_dot">•</span>
                <span>iOS 기기는 <b>iOS 17 이상</b> 버전에서 가장 원활하게 작동합니다.</span>
              </li>
              <li className="help_notice_item">
                <span className="help_notice_dot">•</span>
                <span>기기 사양에 따라 일부 기능의 구동 속도가 다를 수 있습니다.</span>
              </li>
              <li className="help_notice_item">
                <span className="help_notice_dot">•</span>
                <span>이전 V2 뷰어의 데이터는 현재 V3 버전과 <b>동기화되지 않는 점</b> 양해 부탁드립니다.</span>
              </li>
            </ul>
          </div>
        </div>

        {/* 푸터 */}
        <div className="help_modal_footer">
          <button onClick={onClose} className="help_confirm_btn">
            확인했습니다
          </button>
        </div>
      </div>
    </div>
  );
};
