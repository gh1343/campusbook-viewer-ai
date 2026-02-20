import React from "react";
import {
  X,
  Sidebar,
  Pen,
  Columns2,
  Bookmark,
  PanelRight,
  CloudUpload,
  Highlighter,
  Eraser,
  Square,
  AlertCircle,
  BookOpen,
  RefreshCw,
  CloudOff,
} from "lucide-react";
import "../../css/help_modal.css";

interface HelpModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const HelpModal: React.FC<HelpModalProps> = ({ isOpen, onClose }) => {
  const features = [
    {
      icon: <Sidebar className="help_icon_blue" size={20} />,
      title: "목차 및 목록",
      location: "좌측 상단",
      description: "전체 목차를 확인하고 원하는 페이지로 이동합니다.",
      colorClass: "help_feature_icon_blue",
    },
    {
      icon: <span className="help_zoom_badge">100%</span>,
      title: "확대/축소",
      location: "상단 중앙",
      description: "화면 크기를 조절합니다. (PC: Ctrl+휠 / 태블릿: 두 손가락)",
      colorClass: "help_feature_icon_slate",
    },
    {
      icon: <Highlighter className="help_icon_emerald" size={20} />,
      title: "텍스트 선택 및 강조",
      location: "본문 영역",
      description:
        "글자를 길게 누르거나 드래그하여 선택한 뒤 형광펜으로 강조할 수 있습니다.",
      colorClass: "help_feature_icon_emerald",
    },
    {
      icon: (
        <span className="help_view_mode_icons">
          <Square size={14} />
          <Columns2 size={14} />
        </span>
      ),
      title: "보기 모드",
      location: "상단 중앙",
      description:
        "한 쪽 보기 또는 두 쪽 보기 모드를 설정합니다. \n (참고) 태블릿(크롬 등)에서 화면이 밀려 버튼이 안 보이면 가로↔세로 모드를 한 번 전환해 주세요.",
      colorClass: "help_feature_icon_slate",
    },
    {
      icon: (
        <span className="help_drawing_icons">
          <Pen size={14} />
          <Highlighter size={14} />
          <Eraser size={14} />
        </span>
      ),
      title: "필기 도구",
      location: "상단 중앙",
      description: "펜, 형광펜으로 필기하고 지우개로 지울 수 있습니다.",
      colorClass: "help_feature_icon_blue",
    },
    {
      icon: <Bookmark className="help_icon_amber" size={18} />,
      title: "책갈피",
      location: "상단 중앙 우측",
      description: "현재 페이지를 저장하여 나중에 다시 확인합니다.",
      colorClass: "help_feature_icon_amber",
    },
    {
      icon: <PanelRight className="help_icon_purple" size={20} />,
      title: "학습 도구함",
      location: "우측 상단",
      description: "필기 목록, 메모, 검색 등 모든 학습 데이터를 관리합니다.",
      colorClass: "help_feature_icon_purple",
    },
    {
      icon: <CloudUpload className="help_icon_indigo" size={20} />,
      title: "안심 저장 및 동기화",
      location: "우측 상단",
      description:
        "학습 데이터를 보호하는 2단계 저장 시스템입니다. 직접 저장 버튼을 눌러 소중한 기록을 기기와 클라우드에 안전하게 보관하세요.",
      colorClass: "help_feature_icon_indigo",
    },
  ];

  if (!isOpen) return null;

  return (
    <div className="help_modal_overlay" onClick={onClose}>
      <div
        className="help_modal_container"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 헤더 */}
        <div className="help_modal_header">
          <div className="help_modal_title_row">
            <div className="help_modal_icon_wrap">
              <BookOpen size={22} />
            </div>
            <div>
              <h2 className="help_modal_title">이용 가이드</h2>
              <p className="help_modal_subtitle">Quick Start Guide</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="help_modal_close_btn"
            title="닫기"
          >
            <X size={20} />
          </button>
        </div>

        {/* 툴바 맵 */}
        <div className="help_toolbar_map_wrap">
          <div className="help_toolbar_map_inner">
            <div className="help_toolbar_map">
              <div className="help_toolbar_group">
                <div className="help_toolbar_box" />
                <div className="help_toolbar_bar" />
              </div>
              <div className="help_toolbar_group">
                <div className="help_toolbar_pill_blue" />
                <div className="help_toolbar_pill_slate" />
              </div>
              <div className="help_toolbar_group">
                <div className="help_toolbar_box" />
                <div className="help_toolbar_box" />
              </div>
            </div>
            <p className="help_toolbar_map_text">
              상단 툴바를 통해 모든 기능을 제어할 수 있습니다.
            </p>
          </div>
        </div>

        {/* 본문 */}
        <div className="help_modal_body">
          <div className="help_features_grid">
            {features.map((feature, idx) => (
              <div key={idx} className="help_feature_item">
                <div className={`help_feature_icon_box ${feature.colorClass}`}>
                  {feature.icon}
                </div>
                <div className="help_feature_text">
                  <div className="help_feature_title_row">
                    <h3 className="help_feature_title">{feature.title}</h3>
                    <span className="help_feature_location">
                      {feature.location}
                    </span>
                  </div>
                  <p className="help_feature_desc">{feature.description}</p>
                </div>
              </div>
            ))}
          </div>

          {/* 시스템 안내 섹션 */}
          <div className="help_system_section">
            <div className="help_system_grid">
              <div className="help_system_box help_system_blue">
                <h5 className="help_system_box_title help_system_title_blue">
                  <RefreshCw size={10} /> 안심 동기화
                </h5>
                <p className="help_system_box_desc">
                  데이터 보호를 위해 상단의 저장 버튼을 꼭 눌러주세요. 버튼을
                  누르면 네트워크 상태와 관계없이 기기에 즉시 기록됩니다.
                </p>
              </div>
              <div className="help_system_box help_system_amber">
                <h5 className="help_system_box_title help_system_title_amber">
                  <CloudOff size={10} /> 상태 확인 권장
                </h5>
                <p className="help_system_box_desc">
                  상단 '기기 저장됨' 아이콘 확인 시, 안정적인 네트워크에서
                  '동기화 완료'까지 기다려주세요.
                </p>
              </div>
              <div className="help_system_box help_system_rose">
                <h5 className="help_system_box_title help_system_title_rose">
                  데이터 동기화
                </h5>
                <p className="help_system_box_desc help_system_desc_rose">
                  이전 버전(V2)의 데이터는 현재 뷰어(V3)와 동기화되지 않으니
                  이용에 참고해 주세요.
                </p>
              </div>
            </div>

            {/* 기기 안내 */}
            <div className="help_device_notice">
              <div className="help_device_notice_left">
                <AlertCircle size={14} className="help_icon_slate" />
                <p className="help_device_notice_text">
                  iOS 17 이상 권장 · 기기 사양 및 환경에 따라 구동이 다를 수
                  있음
                </p>
              </div>
              <p className="help_device_notice_sub">
                최신 브라우저 환경에서 가장 원활하게 작동합니다.
              </p>
            </div>
          </div>
        </div>

        {/* 푸터 */}
        <div className="help_modal_footer">
          <button onClick={onClose} className="help_confirm_btn">
            가이드 닫기
          </button>
        </div>
      </div>
    </div>
  );
};
